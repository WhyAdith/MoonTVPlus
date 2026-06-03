import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getAvailableApiSites, getConfig } from '@/lib/config';
import { isXmlResponse } from '@/lib/xml-parser';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

/**
 * 解析XML格式的分类列表
 */
async function parseXmlClassList(xmlText: string): Promise<CmsClassResponse> {
  const parsed = await parseStringPromise(xmlText, {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const rss = parsed?.rss;
  if (!rss) return { class: [] };

  const classData = rss.class;
  if (!classData) return { class: [] };

  let items = classData.ty || [];
  if (!Array.isArray(items)) items = [items];

  return {
    class: items.map((item: any) => ({
      type_id: item._ || item.id || '',
      type_name: item._ || item.name || '',
    })),
  };
}

/**
 * 获取指定视频源的分类列表
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');

  if (!sourceKey) {
    return NextResponse.json(
      { error: '缺少参数: source' },
      { status: 400 }
    );
  }

  try {
    const config = await getConfig();
    const apiSites = await getAvailableApiSites(authInfo.username);
    const targetSite = apiSites.find((site) => site.key === sourceKey);

    if (!targetSite) {
      return NextResponse.json(
        { error: `未找到指定的视频源: ${sourceKey}` },
        { status: 404 }
      );
    }

    // 请求分类列表
    const classUrl = `${targetSite.api}?ac=list`;
    const classResponse = await fetch(classUrl, {
      headers: API_CONFIG.search.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!classResponse.ok) {
      throw new Error('获取分类列表失败');
    }

    // 读取响应文本，检测是否为XML格式
    const responseText = await classResponse.text();
    let classData: CmsClassResponse;

    if (isXmlResponse(classResponse, responseText)) {
      classData = await parseXmlClassList(responseText);
    } else {
      try {
        classData = JSON.parse(responseText);
      } catch {
        throw new Error('解析分类列表失败');
      }
    }

    // XML源没有class数据时，从视频列表中提取tid生成分类
    if ((!classData.class || !Array.isArray(classData.class) || classData.class.length === 0)
        && targetSite.api.includes('xml.php')) {
      try {
        const videoUrl = `${targetSite.api}?ac=detail&pg=1`;
        const videoResp = await fetch(videoUrl, {
          headers: API_CONFIG.search.headers,
          signal: AbortSignal.timeout(10000),
        });
        const videoText = await videoResp.text();
        const tidMatches = videoText.match(/<tid>(\d+)<\/tid>/g) || [];
        const tidMap: Record<string, boolean> = {};
        tidMatches.forEach(m => { tidMap[m.replace(/<\/?tid>/g, '')] = true; });
        const uniqueTids = Object.keys(tidMap).sort((a,b) => Number(a) - Number(b));

        const ADULT_CATEGORY_MAP: Record<string, string> = {
          '1': '电影', '2': '连续剧', '3': '综艺', '4': '动漫',
          '20': '伦理片', '21': '教程', '22': '国产', '23': '国产精品',
          '24': '日韩', '25': '欧美', '26': '中文字幕', '27': '巨乳',
          '28': '人妻', '29': '制服诱惑', '30': '欧美精品', '31': '动漫H',
          '33': '成人动漫', '34': '自拍', '35': 'SM调教', '36': '口交',
          '37': '综合', '38': 'Cosplay', '39': '素人', '40': '台湾',
          '41': '韩国', '42': '港姐', '43': '东南亚', '44': '凌辱',
          '45': '剧情', '46': '多人', '47': '91探花', '48': '网红流出',
        };

        classData = {
          class: uniqueTids.map(tid => ({
            type_id: tid,
            type_name: ADULT_CATEGORY_MAP[tid] || `分类${tid}`,
          })),
        };
      } catch {
        // fallback failed, return empty
      }
    }

    if (!classData.class || !Array.isArray(classData.class)) {
      return NextResponse.json({
        categories: [],
      });
    }

    // 应用黄色过滤器规则
    let filteredCategories = classData.class;
    if (!config.SiteConfig.DisableYellowFilter) {
      filteredCategories = classData.class.filter((item) => {
        const typeName = item.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    return NextResponse.json({
      categories: filteredCategories.map((item) => ({
        id: item.type_id.toString(),
        name: item.type_name,
      })),
    });
  } catch (error) {
    console.error('Failed to get categories:', error);
    return NextResponse.json(
      { error: '获取分类列表失败' },
      { status: 500 }
    );
  }
}
