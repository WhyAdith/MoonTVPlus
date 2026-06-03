import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getAvailableApiSites, getConfig } from '@/lib/config';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

/**
 * 检测响应是否为XML格式
 */
function isXmlResponse(response: Response, text: string): boolean {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('xml')) return true;
  return text.trimStart().startsWith('<?xml');
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
