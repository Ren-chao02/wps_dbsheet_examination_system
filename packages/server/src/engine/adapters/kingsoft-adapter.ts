/**
 * 金山多维表格 API 适配器
 *
 * 封装对 WPS 开放平台服务端 REST API 的调用。
 * Demo 阶段使用 Mock 数据，Phase 2 切换为真实 API。
 */

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

// ============================================================
// 适配器类
// ============================================================

export class KingsoftAdapter {
  private fileId: string;
  private accessToken: string;

  constructor(fileId: string, accessToken: string) {
    this.fileId = fileId;
    this.accessToken = accessToken;
  }

  /** 获取完整 Schema（核心方法） */
  async getSchema(): Promise<SchemaResponse> {
    return this.request('/schema/query', {});
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
  ): Promise<{ records: RecordInfo[]; offset: string }> {
    return this.request('/record/list', {
      sheetId,
      pageSize: options?.pageSize ?? 100,
      viewId: options?.viewId,
      fields: options?.fields,
    });
  }

  // ============================================================
  // 底层 HTTP 请求（含 WPS-3 签名）
  // ============================================================

  private async request<T>(action: string, params: Record<string, any>): Promise<T> {
    const url = `${API_BASE}/${this.fileId}/core/execute${action}?access_token=${this.accessToken}`;
    const body = JSON.stringify({ param: params });
    const headers = this.buildHeaders(body);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /** 构建 WPS-3 签名请求头 */
  private buildHeaders(body: string): Record<string, string> {
    const date = new Date().toUTCString();
    const md5 = this.md5(body);
    // WPS-3 签名 = Base64(HMAC-SHA1(secret, md5 + content-type + date))
    // 此处为简化实现，生产环境需使用完整签名算法
    return {
      'Content-Type': 'application/json',
      'Content-Md5': md5,
      Date: date,
      // 'X-Auth': this.sign(md5, date), // Phase 2 实现
    };
  }

  /** MD5 哈希（简化实现） */
  private md5(str: string): string {
    // 生产环境使用 crypto.createHash('md5').update(str).digest('hex')
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}
