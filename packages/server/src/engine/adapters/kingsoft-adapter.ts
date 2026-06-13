/**
 * 金山多维表格 API 适配器
 *
 * 封装对 WPS 开放平台服务端 REST API 的调用。
 * 实现 WPS-3 签名鉴权（HMAC-SHA1 + MD5）。
 */

import crypto from 'crypto';
import { config } from '../../config';

const API_BASE = 'https://openapi.wps.cn/kopen/office/file';

// ============================================================
// 类型定义
// ============================================================

export interface FieldInfo {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  items?: { value: string; color?: number }[];
  linkSheet?: string;
  multipleLinks?: boolean;
}

export interface ViewInfo {
  id: string;
  name: string;
  type: 'Grid' | 'Kanban' | 'Gallery' | 'Form' | 'Calendar' | 'Gantt' | 'Query';
  filter?: any;
  sort?: any;
  group?: any;
}

export interface TableInfo {
  id: number;
  name: string;
  primaryFieldId: string;
  fields: FieldInfo[];
  views: ViewInfo[];
}

export interface SchemaResponse {
  result: number;
  detail: {
    sheets: TableInfo[];
  };
}

export interface RecordInfo {
  id: string;
  fields: Record<string, any>;
}

export interface RecordListResponse {
  result: number;
  detail: {
    fieldsSchema: { id: string; name: string; type: string }[];
    offset: string;
    records: RecordInfo[];
  };
}

// ============================================================
// 适配器类
// ============================================================

export class KingsoftAdapter {
  private fileId: string;
  private accessToken: string;
  private apiSecret: string;

  constructor(fileId: string, accessToken: string, apiSecret?: string) {
    this.fileId = fileId;
    this.accessToken = accessToken;
    this.apiSecret = apiSecret || config.kingsoft.apiSecret;
  }

  /** 获取完整 Schema（核心方法） */
  async getSchema(): Promise<SchemaResponse> {
    return this.request<SchemaResponse>('/schema/query', {});
  }

  /** 获取所有表 */
  async getTables(): Promise<TableInfo[]> {
    const schema = await this.getSchema();
    return schema.detail.sheets;
  }

  /** 获取指定表的字段列表 */
  async getFields(tableName: string): Promise<FieldInfo[]> {
    const tables = await this.getTables();
    const table = tables.find(t => t.name === tableName);
    if (!table) throw new Error(`表 "${tableName}" 不存在`);
    return table.fields;
  }

  /** 获取指定表的视图列表 */
  async getViews(tableName: string): Promise<ViewInfo[]> {
    const tables = await this.getTables();
    const table = tables.find(t => t.name === tableName);
    if (!table) throw new Error(`表 "${tableName}" 不存在`);
    return table.views;
  }

  /** 获取记录列表 */
  async getRecords(
    sheetId: number,
    options?: { pageSize?: number; viewId?: string; fields?: string[] }
  ): Promise<RecordListResponse> {
    return this.request<RecordListResponse>('/record/list', {
      sheetId,
      pageSize: options?.pageSize ?? 100,
      viewId: options?.viewId,
      fields: options?.fields,
      showFieldsInfo: true,
    });
  }

  /** 获取指定表的所有记录 */
  async getRecordsByTableName(
    tableName: string,
    options?: { pageSize?: number }
  ): Promise<{ records: RecordInfo[]; fieldsSchema: { id: string; name: string; type: string }[] }> {
    const tables = await this.getTables();
    const table = tables.find(t => t.name === tableName);
    if (!table) throw new Error(`表 "${tableName}" 不存在`);

    const response = await this.getRecords(table.id, options);
    return {
      records: response.detail.records,
      fieldsSchema: response.detail.fieldsSchema,
    };
  }

  // ============================================================
  // 底层 HTTP 请求（含 WPS-3 签名）
  // ============================================================

  private async request<T>(action: string, params: Record<string, any>): Promise<T> {
    const baseUrl = config.kingsoft.apiBaseUrl || API_BASE;
    const url = `${baseUrl}/${this.fileId}/core/execute${action}?access_token=${this.accessToken}`;
    const body = JSON.stringify({ param: params });
    const headers = this.buildHeaders(body);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API 请求失败 [${action}]: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json() as T & { result?: number };

    // WPS API 约定 result=0 表示成功
    if (data.result !== undefined && data.result !== 0) {
      throw new Error(`API 返回错误 [${action}]: result=${data.result}, ${JSON.stringify(data)}`);
    }

    return data;
  }

  /** 构建 WPS-3 签名请求头 */
  private buildHeaders(body: string): Record<string, string> {
    const date = new Date().toUTCString();
    const contentMd5 = this.md5Hash(body);
    const contentType = 'application/json';

    // WPS-3 签名: Base64(HMAC-SHA1(secret, Content-MD5 + "\n" + Content-Type + "\n" + Date))
    const signString = `${contentMd5}\n${contentType}\n${date}`;
    const signature = this.hmacSha1(signString, this.apiSecret);

    return {
      'Content-Type': contentType,
      'Content-Md5': contentMd5,
      'Date': date,
      'X-Auth': signature,
    };
  }

  /** MD5 哈希（十六进制小写） */
  private md5Hash(str: string): string {
    return crypto.createHash('md5').update(str, 'utf-8').digest('hex');
  }

  /** HMAC-SHA1 → Base64 */
  private hmacSha1(data: string, secret: string): string {
    return crypto.createHmac('sha1', secret).update(data, 'utf-8').digest('base64');
  }
}

// ============================================================
// 工厂方法：从 submission 的 tableSpaceId 解析出 adapter
// ============================================================

/**
 * tableSpaceId 格式约定：
 *   "fileId:accessToken"
 *   或 "fileId:accessToken:apiSecret"
 *
 * 如果未配置 tableSpaceId，返回 null（将使用 mock 模式）
 */
export function createAdapterFromSpaceId(tableSpaceId: string | null | undefined): KingsoftAdapter | null {
  if (!tableSpaceId) return null;

  const parts = tableSpaceId.split(':');
  if (parts.length < 2) return null;

  const [fileId, accessToken, apiSecret] = parts;
  if (!fileId || !accessToken) return null;

  return new KingsoftAdapter(fileId, accessToken, apiSecret);
}
