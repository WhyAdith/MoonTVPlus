/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseStringPromise } from 'xml2js';

/**
 * 检测响应是否为XML格式
 */
export function isXmlResponse(response: Response, text: string): boolean {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('xml')) return true;
  return text.trimStart().startsWith('<?xml');
}

/**
 * 解析XML格式的视频列表为JSON格式
 */
export async function parseXmlVideoList(xmlText: string): Promise<any> {
  const parsed = await parseStringPromise(xmlText, {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const rss = parsed?.rss;
  if (!rss) return null;

  const list = rss.list;
  if (!list) return null;

  const page = parseInt(list.page || '1', 10);
  const pagecount = parseInt(list.pagecount || '1', 10);
  const pagesize = parseInt(list.pagesize || '20', 10);
  const recordcount = parseInt(list.recordcount || '0', 10);

  let videos = list.video || [];
  if (!Array.isArray(videos)) videos = [videos];

  const vodList = videos.map((v: any) => {
    // 解析播放地址 - XML格式: <dl><dd flag="ckplayer">url1$url2</dd></dl>
    let playUrl = '';
    if (v.dl?.dd) {
      const dd = v.dl.dd;
      if (Array.isArray(dd)) {
        // 多个播放源，取第一个
        const firstDd = dd[0];
        playUrl = typeof firstDd === 'string' ? firstDd : (firstDd._ || '');
      } else if (typeof dd === 'string') {
        playUrl = dd;
      } else if (dd._) {
        playUrl = dd._;
      }
    }

    return {
      vod_id: v.id || '',
      vod_name: v.name || '',
      vod_pic: v.pic || v.img || '',
      vod_remarks: v.note || '',
      vod_play_url: playUrl,
      vod_class: v.type || '',
      vod_year: v.year || '',
      vod_content: v.des || '',
      type_name: v.tid ? `类型${v.tid}` : '',
    };
  });

  return {
    page,
    pagecount,
    pagesize,
    total: recordcount,
    recordcount,
    list: vodList,
  };
}
