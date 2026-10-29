'use client';

import { useState, useEffect } from 'react';
import AIChatPanel from '@/components/AIChatPanel';
import { base58Encode } from '@/lib/utils';
import Toast, { ToastProps } from '@/components/Toast';

export function GlobalModals() {
  const [showAIChat, setShowAIChat] = useState(false);
  const [showDirectPlayDialog, setShowDirectPlayDialog] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageNoVideo, setAiDefaultMessageNoVideo] = useState('');
  const [netdiskTempPlayEnabled, setNetdiskTempPlayEnabled] = useState(false);
  const [directPlayUrl, setDirectPlayUrl] = useState('');
  const [directPlaySubmitting, setDirectPlaySubmitting] = useState(false);
  const [toast, setToast] = useState<ToastProps | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_HOMEPAGE_ENTRY;
      setAiEnabled(enabled);

      const defaultMsg = (window as any).RUNTIME_CONFIG
        ?.AI_DEFAULT_MESSAGE_NO_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageNoVideo(defaultMsg);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled = !!(window as any).RUNTIME_CONFIG
        ?.NETDISK_TEMP_PLAY_ENABLED;
      setNetdiskTempPlayEnabled(enabled);
    }
  }, []);

  useEffect(() => {
    const handleOpenAIChat = () => setShowAIChat(true);
    const handleOpenDirectPlay = () => setShowDirectPlayDialog(true);

    window.addEventListener('openAIChat', handleOpenAIChat);
    window.addEventListener('openDirectPlay', handleOpenDirectPlay);
    return () => {
      window.removeEventListener('openAIChat', handleOpenAIChat);
      window.removeEventListener('openDirectPlay', handleOpenDirectPlay);
    };
  }, []);

  const detectNetdiskLink = (
    url: string
  ): {
    provider: 'quark' | 'mobile' | 'baidu' | 'tianyi' | '123' | 'uc' | '115';
    shareUrl: string;
    passcode?: string;
  } | null => {
    const trimmed = url.trim();

    const pickPasscode = (...values: Array<string | undefined>) =>
      values.map((item) => item?.trim()).find(Boolean);

    const inlinePasscode = (text: string) =>
      pickPasscode(
        text.match(
          /(?:提取码|访问码|密码)\s*[:：=]?\s*([a-zA-Z0-9]{4,8})/i
        )?.[1],
        text.match(/[?&](?:pwd|passcode|accessCode)=([^&\s]+)/i)?.[1]
      );

    if (
      /https:\/\/(?:www\.)?123(?:684|865|912|pan)\.(?:com|cn)\/s\//i.test(
        trimmed
      )
    ) {
      return {
        provider: '123',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (
      /https:\/\/cloud\.189\.cn\/(web\/share\?code=|t\/)/i.test(trimmed) ||
      /https:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\//i.test(trimmed)
    ) {
      return {
        provider: 'tianyi',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/pan\.baidu\.com\/(s\/|wap\/init\?surl=)/i.test(trimmed)) {
      return {
        provider: 'baidu',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|accessCode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/pan\.quark\.cn\/s\//i.test(trimmed)) {
      return {
        provider: 'quark',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/drive\.uc\.cn\/s\//i.test(trimmed)) {
      return {
        provider: 'uc',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/(?:yun|caiyun)\.139\.com\//i.test(trimmed)) {
      return { provider: 'mobile', shareUrl: trimmed };
    }

    if (/https:\/\/(?:115|anxia|115cdn)\.com\/s\//i.test(trimmed)) {
      return {
        provider: '115',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:password|pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    return null;
  };

  const submitDirectPlay = async () => {
    const trimmed = directPlayUrl.trim();
    if (!trimmed) return;
    setDirectPlaySubmitting(true);
    try {
      const netdisk = detectNetdiskLink(trimmed);
      if (netdisk && !netdiskTempPlayEnabled) {
        throw new Error('无权限使用临时播放');
      }

      if (netdisk) {
        const source =
          netdisk.provider === 'mobile'
            ? 'netdisk-mobile'
            : netdisk.provider === 'baidu'
            ? 'netdisk-baidu'
            : netdisk.provider === 'tianyi'
            ? 'netdisk-tianyi'
            : netdisk.provider === '115'
            ? 'netdisk-115'
            : netdisk.provider === 'uc'
            ? 'netdisk-uc'
            : netdisk.provider === '123'
            ? 'netdisk-123'
            : 'netdisk-quark';
        const id = base58Encode(
          JSON.stringify({
            shareUrl: netdisk.shareUrl,
            passcode: netdisk.passcode || '',
          })
        );
        if (!id) {
          throw new Error('网盘链接编码失败');
        }
        const targetUrl = `/play?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(
          '网盘直链播放'
        )}`;
        setShowDirectPlayDialog(false);
        setDirectPlayUrl('');
        setDirectPlaySubmitting(false);
        window.location.assign(targetUrl);
        return;
      }

      const encoded = base58Encode(trimmed);
      if (!encoded) return;
      const targetUrl = `/play?source=directplay&id=${encodeURIComponent(
        encoded
      )}`;
      setShowDirectPlayDialog(false);
      setDirectPlayUrl('');
      setDirectPlaySubmitting(false);
      window.location.assign(targetUrl);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : '播放失败',
        type: 'error',
        onClose: () => setToast(null),
      });
      setDirectPlaySubmitting(false);
    }
  };

  return (
    <>
      {aiEnabled && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          welcomeMessage={aiDefaultMessageNoVideo}
        />
      )}

      {showDirectPlayDialog && (
        <div
          className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
          onClick={() => setShowDirectPlayDialog(false)}
        >
          <div
            className='bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                直链播放
              </h3>
              <button
                onClick={() => setShowDirectPlayDialog(false)}
                className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'
                aria-label='关闭'
              >
                <span className='text-gray-600 dark:text-gray-400'>×</span>
              </button>
            </div>
            <div className='p-4 space-y-4'>
              <div className='text-sm text-gray-600 dark:text-gray-300'>
                请输入可直接播放的视频链接。
              </div>
              {netdiskTempPlayEnabled && (
                <div className='text-xs text-gray-500 dark:text-gray-400'>
                  支持夸克、UC、百度、天翼、移动、123、115 网盘在线播放。
                </div>
              )}
              <input
                value={directPlayUrl}
                onChange={(event) => setDirectPlayUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitDirectPlay();
                  }
                }}
                placeholder='https://example.com/video.m3u8'
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
              />
              <div className='flex justify-end gap-2'>
                <button
                  onClick={() => setShowDirectPlayDialog(false)}
                  className='px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={submitDirectPlay}
                  disabled={!directPlayUrl.trim() || directPlaySubmitting}
                  className='px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  {directPlaySubmitting ? '处理中...' : '开始播放'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {toast && <Toast {...toast} />}
    </>
  );
}
