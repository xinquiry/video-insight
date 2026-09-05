/**
 * Range 分块下载器。
 *
 * 生产隧道(FRP)在大文件长连接下会不定期掐断,一次性下载 500MB 几乎必然
 * 中段失败。对象存储(MinIO/R2)的预签名 URL 支持 HTTP Range,且 media 通道
 * 已验证稳定,因此把大对象拆成小块顺序拉取,每块独立重试,断流只重传当前
 * 小块而不是整个文件。这是 S3 客户端(aws-sdk/rclone)的标准下载策略。
 */

export type ChunkedDownloadOptions = {
  /** 块大小,默认 8 MiB。 */
  chunkSize?: number;
  /** 单块最大重试次数,默认 5。 */
  maxRetries?: number;
  /** 已下载字节回调(用于进度)。 */
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  /** 中止信号。 */
  signal?: AbortSignal;
};

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchChunk(
  url: string,
  start: number,
  endInclusive: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    signal,
  });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`chunk request failed with status ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/** 探测对象是否支持 Range,并返回总大小。 */
async function probeSize(url: string, signal?: AbortSignal): Promise<number> {
  const first = await fetch(url, { headers: { Range: "bytes=0-0" }, signal });
  if (first.status === 206) {
    const contentRange = first.headers.get("Content-Range");
    const match = contentRange?.match(/\/(\d+)\s*$/);
    if (match) return Number(match[1]);
  }
  // 不支持 Range 时回退到 Content-Length(整对象一次拉)。
  const length = first.headers.get("Content-Length");
  if (first.status === 200 && length) return Number(length);
  throw new Error("could not determine object size for download");
}

/**
 * 分块下载整个对象到内存,返回完整字节。
 * 调用方(导出组包)需要完整字节才能组 zip,因此这里返回 Uint8Array;
 * 下载过程本身仍是分块+重试的,单块失败不会丢失已完成的块。
 */
export async function downloadObject(
  url: string,
  options: ChunkedDownloadOptions = {},
): Promise<Uint8Array> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const { signal } = options;

  const total = await probeSize(url, signal);
  const result = new Uint8Array(total);
  let received = 0;

  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("Download aborted", "AbortError");
    const end = Math.min(offset + chunkSize, total) - 1;

    let chunk: Uint8Array | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        chunk = await fetchChunk(url, offset, end, signal);
        break;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw new DOMException("Download aborted", "AbortError");
        }
        lastError = error;
        // 指数退避:0.5s, 1s, 2s, 4s, 8s。
        await sleep(Math.min(500 * 2 ** attempt, 8000));
      }
    }
    if (!chunk) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`failed to download chunk at offset ${offset}`);
    }

    result.set(chunk, offset);
    received += chunk.length;
    offset += chunk.length;
    options.onProgress?.(received, total);
  }

  return result;
}
