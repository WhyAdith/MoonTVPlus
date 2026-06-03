import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 检测响应是否为XML格式
 */
function isXmlResponse(response: Response, text: string): boolean {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('xml')) return true;
  return text.trimStart().startsWith('<?xml');
}

/**
 * 解析XML格式的视频列表
 */
async function parseXmlVideoList(
  xmlText: string
): Promise<CmsVideoResponse> {
  const parsed = await parseStringPromise(xmlText, {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const rss = parsed?.rss;
  if (!rss) return { list: [] };

  const list = rss.list;
  if (!list) return { list: [] };

  const attrs = list.$ || {};
  const page = parseInt(attrs.page) || 1;
  const pagecount = parseInt(attrs.pagecount) || 1;
  const total = parseInt(attrs.recordcount) || 0;

  let videos = list.video || [];
  if (!Array.isArray(videos)) videos = [videos];

  return {
    list: videos.map((v: any) => ({
      vod_id: v.id || '',
      vod_name: v.name || '',
      vod_pic: v.pic || '',
      vod_remarks: v.note || '',
      vod_year: '',
      vod_play_from: '',
      vod_play_url: v.vod_play_url || '',
    })),
    page,
    pagecount,
    total,
  };
}

interface CmsVideoItem {
  vod_id: string | number;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_year?: string;
  vod_play_from?: string;
  vod_play_url?: string;
}

interface CmsVideoResponse {
  list?: CmsVideoItem[];
  total?: number;
  page?: number;
  pagecount?: number;
}

/**
 * 获取指定视频源的分类视频列表
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');
  const categoryId = searchParams.get('categoryId');
  const page = searchParams.get('page') || '1';

  if (!sourceKey) {
    return NextResponse.json(
      { error: '缺少参数: source' },
      { status: 400 }
    );
  }

  if (!categoryId) {
    return NextResponse.json(
      { error: '缺少参数: categoryId' },
      { status: 400 }
    );
  }

  try {
    const apiSites = await getAvailableApiSites(authInfo.username);
    const targetSite = apiSites.find((site) => site.key === sourceKey);

    if (!targetSite) {
      return NextResponse.json(
        { error: `未找到指定的视频源: ${sourceKey}` },
        { status: 404 }
      );
    }

    // 请求分类视频列表
    const videoUrl = `${targetSite.api}?ac=videolist&t=${categoryId}&pg=${page}`;
    const videoResponse = await fetch(videoUrl, {
      headers: API_CONFIG.search.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!videoResponse.ok) {
      throw new Error('获取视频列表失败');
    }

    // 读取响应文本，检测是否为XML格式
    const responseText = await videoResponse.text();
    let videoData: CmsVideoResponse;

    if (isXmlResponse(videoResponse, responseText)) {
      videoData = await parseXmlVideoList(responseText);
    } else {
      try {
        videoData = JSON.parse(responseText);
      } catch {
        throw new Error('解析视频列表失败');
      }
    }

    if (!videoData.list || !Array.isArray(videoData.list)) {
      return NextResponse.json({
        results: [],
        total: 0,
        page: parseInt(page),
        pageCount: 0,
      });
    }

    // 转换为 SearchResult 格式
    const results: SearchResult[] = videoData.list.map((item) => {
      const episodes: string[] = [];
      const episodes_titles: string[] = [];

      // 解析播放信息
      if (item.vod_play_url && item.vod_play_from) {
        const playUrls = item.vod_play_url.split('#');
        playUrls.forEach((episodeStr) => {
          if (episodeStr.trim()) {
            const [name, url] = episodeStr.split('$');
            if (name && url) {
              episodes.push(url.trim());
              episodes_titles.push(name.trim());
            }
          }
        });
      }

      return {
        id: item.vod_id.toString(),
        title: item.vod_name,
        poster: item.vod_pic || '',
        year: item.vod_year || 'unknown',
        episodes,
        episodes_titles,
        source: targetSite.key,
        source_name: targetSite.name,
      };
    });

    return NextResponse.json({
      results,
      total: videoData.total || 0,
      page: parseInt(page),
      pageCount: videoData.pagecount || 0,
    });
  } catch (error) {
    console.error('Failed to get videos:', error);
    return NextResponse.json(
      { error: '获取视频列表失败' },
      { status: 500 }
    );
  }
}
