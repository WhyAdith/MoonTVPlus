/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * TVBox CMS 代理接口
 * 自动为CMS API请求添加ac=detail，确保返回播放地址
 * GET /api/tvbox/cms-proxy?url=<CMS API地址>&参数1=值1&参数2=值2...
 */
export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiUrl = searchParams.get('url');

    if (!apiUrl) {
      return NextResponse.json(
        { error: '缺少必要参数: url' },
        { status: 400 }
      );
    }

    // 构建完整的 API 请求 URL
    const targetUrl = new URL(apiUrl);

    // 将所有查询参数（除了 url）转发到目标 API
    searchParams.forEach((value, key) => {
      if (key !== 'url') {
        targetUrl.searchParams.append(key, value);
      }
    });

    console.log(`TVBox CMS 代理请求 [${request.method}]:`, targetUrl.toString());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const fetchOptions: RequestInit = {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      };

      if (request.method === 'POST') {
        const contentType = request.headers.get('content-type');
        if (contentType) {
          (fetchOptions.headers as any)['Content-Type'] = contentType;
        }
        try {
          const bodyBuffer = await request.arrayBuffer();
          if (bodyBuffer.byteLength > 0) {
            fetchOptions.body = bodyBuffer;
          }
        } catch (e) {
          console.warn('读取 POST body 失败:', e);
        }
      }

      const response = await fetch(targetUrl.toString(), fetchOptions);

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('CMS API 请求失败:', response.status, response.statusText);
        return NextResponse.json(
          { error: '请求 CMS API 失败' },
          { status: response.status }
        );
      }

      const data = await response.json();

      // 获取当前请求的 origin
      let origin = process.env.SITE_BASE;
      if (!origin) {
        const host = request.headers.get('x-original-host') || request.headers.get('x-forwarded-host') || request.headers.get('host');
        const proto = request.headers.get('x-forwarded-proto') ||
                      (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
        origin = `${proto}://${host}`;
        
        // 腾讯云反代临时修复：强制替换 Vercel 域名
        if (origin.includes('congtv.cc.cd') || origin.includes('vercel.app')) {
          origin = 'http://119.91.227.199:8888';
        }
      }

      // 处理返回数据，替换播放链接为代理链接
      const processedData = processCmsResponse(data, origin);

      return NextResponse.json(processedData, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('CMS API 请求超时:', targetUrl.toString());
        return NextResponse.json(
          { error: '请求超时' },
          { status: 504 }
        );
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('TVBox CMS 代理失败:', error);
    return NextResponse.json(
      { error: '代理失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 处理 CMS API 返回数据，将播放链接替换为代理链接
 */
function processCmsResponse(data: any, proxyOrigin: string): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const processedData = JSON.parse(JSON.stringify(data));

  // 获取 M3U8 代理 token
  const proxyToken = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN || '';
  const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';

  // 处理列表数据
  if (processedData.list && Array.isArray(processedData.list)) {
    processedData.list = processedData.list.map((item: any) => {
      if (item.vod_play_url && typeof item.vod_play_url === 'string') {
        try {
          item.vod_play_url = processPlayUrlString(item.vod_play_url, item.vod_play_from || '', proxyOrigin, tokenParam);
        } catch (error) {
          console.error('处理播放地址失败:', error, item.vod_name);
        }
      }
      return item;
    });
  }

  return processedData;
}

/**
 * 处理播放地址字符串
 * 格式: 第01集$url1#第02集$url2#...
 */
function processPlayUrlString(playUrl: string, playFrom: string, proxyOrigin: string, tokenParam: string): string {
  if (!playUrl) return playUrl;

  const playSources = playUrl.split('$$$');

  return playSources.map(source => {
    const episodes = source.split('#');

    return episodes.map(episode => {
      const dollarIndex = episode.indexOf('$');

      if (dollarIndex > 0) {
        const title = episode.substring(0, dollarIndex);
        const rest = episode.substring(dollarIndex + 1);

        const nextDollarIndex = rest.indexOf('$');
        if (nextDollarIndex > 0) {
          const url = rest.substring(0, nextDollarIndex);
          const other = rest.substring(nextDollarIndex);
          const processedUrl = processUrl(url.trim(), playFrom, proxyOrigin, tokenParam);
          return `${title}$${processedUrl}${other}`;
        } else {
          const processedUrl = processUrl(rest.trim(), playFrom, proxyOrigin, tokenParam);
          return `${title}$${processedUrl}`;
        }
      } else if (episode.trim()) {
        const processedUrl = processUrl(episode.trim(), playFrom, proxyOrigin, tokenParam);
        return processedUrl;
      }

      return episode;
    }).join('#');
  }).join('$$$');
}

/**
 * 处理单个播放地址
 */
function processUrl(url: string, playFrom: string, proxyOrigin: string, tokenParam: string): string {
  if (!url) return url;

  if (url.includes('.m3u8')) {
    const source = playFrom ? `&source=${encodeURIComponent(playFrom)}` : '';
    return `${proxyOrigin}/api/proxy-m3u8?url=${encodeURIComponent(url)}${source}${tokenParam}&ext=.m3u8`;
  }

  return url;
}
