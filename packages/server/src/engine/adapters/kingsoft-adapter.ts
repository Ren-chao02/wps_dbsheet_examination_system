/**
 * 金山多维表格 API 适配器
 *
 * 封装对 WPS 开放平台服务端 REST API 的调用。
 * 支持两种鉴权方式：
 *   - v7：Bearer JWT（Authorization 头），对应 /v7/coop/dbsheet 路径
 *   - v3：WPS-3 签名（HMAC-SHA1 + MD5），对应 /kopen/office/file 路径
 */

import crypto from 'crypto';
import { config } from '../../config';

// 默认使用 v7 API
const V7_API_BASE = 'https://openapi.wps.cn/v7/coop/dbsheet';
const V3_API_BASE = 'https://openapi.wps.cn/kopen/office/file';

// ============================================================
// 类型定义
// ============================================================

/**
 * 字段信息 — 涵盖 v7 API 全部 27 种字段类型的属性
 * 参考: https://open.wps.cn/documents/.../parameters-description
 */
export interface FieldInfo {
  id: string;
  name: string;
  type: string;
  required?: boolean;

  // ---- 选择类 (SingleSelect / MultipleSelect) ----
  items?: { value: string; color?: number; id?: string }[];
  allowAddItemWhileInputting?: boolean;

  // ---- 关联 (Link) ----
  linkSheet?: string | number;
  linkView?: string;
  isAuto?: boolean;
  multipleLinks?: boolean;
  linkFilter?: { mode: string; conditions: { current_sheet_field_id: string; link_sheet_field_id: string }[] };

  // ---- 引用 (Lookup) ----
  linkField?: string;
  lookupField?: string;
  aggregation?: string;
  baseType?: string;
  lookupSheetId?: number;

  // ---- 格式控制 (Date / Time / Number / Currency / Percent / Formula / AutoNumber / CreatedTime / LastModifiedTime) ----
  numberFormat?: string;

  // ---- 公式 (Formula) ----
  formula?: string;
  valueType?: string;

  // ---- 等级 (Rating) ----
  maxValue?: number;

  // ---- 唯一性 (MultiLineText / ID / Phone) ----
  uniqueValue?: boolean;

  // ---- 默认值 (Date / Contact) ----
  defaultValueType?: string;
  defaultValue?: string;

  // ---- 超链接 (Url) ----
  displayText?: string;

  // ---- 联系人 (Contact) ----
  multipleContacts?: boolean;
  noticeNewContact?: boolean;

  // ---- 附件 (Attachment) ----
  onlyUploadByCamera?: boolean;

  // ---- 地址 (Address) ----
  addressLevel?: number;
  detailedAddress?: boolean;
  presetAddress?: { detail?: string; districts?: string[] };

  // ---- 最后修改者/时间 (LastModifiedBy / LastModifiedTime) ----
  watchAll?: boolean;
  watchedField?: string[];

  // ---- v7 原始 data 对象（兜底，保留未映射的属性） ----
  data?: Record<string, any>;
}

/** 视图类型枚举 — v7 API 支持 6 种视图 */
export type ViewType = 'Grid' | 'Kanban' | 'Gallery' | 'Form' | 'Gantt' | 'Query';

export interface ViewInfo {
  id: string;
  name: string;
  type: ViewType;
  filter?: {
    mode?: string;
    criteria?: { field: string; operator: string; values: string[] }[];
  };
  sort?: {
    mode?: string;
    conditions?: { field: string; order: string }[];
  };
  group?: {
    mode?: string;
    conditions?: { field: string; order: string }[];
  };
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
  private apiVersion: 'v3' | 'v7';

  constructor(
    fileId: string,
    accessToken: string,
    apiSecret?: string,
    apiVersion?: 'v3' | 'v7',
  ) {
    this.fileId = fileId;
    this.accessToken = accessToken;
    this.apiSecret = apiSecret || config.kingsoft.apiSecret;
    this.apiVersion = apiVersion || 'v7';
  }

  /** 获取完整 Schema（核心方法） */
  async getSchema(): Promise<SchemaResponse> {
    if (this.apiVersion === 'v7') {
      return this.getSchemaV7();
    }
    return this.request<SchemaResponse>('/schema/query', {});
  }

  /**
   * v7 Schema 获取 + 响应归一化
   * v7 返回 { code, msg, data: { sheets: [...] } }
   * 需转换为 v3 格式 { result, detail: { sheets: [...] } }
   */
  private async getSchemaV7(): Promise<SchemaResponse> {
    const raw = await this.requestV7<any>('/schema/query', {});

    // v7 响应: { code: 0, msg: "", data: { sheets: [...] } }
    if (raw.code !== undefined && raw.code !== 0) {
      throw new Error(`API 返回错误 [/schema/query]: code=${raw.code}, msg=${raw.msg}`);
    }

    const v7data = raw.data || raw.detail || raw;
    const sheets = (v7data.sheets || []).map((sheet: any) => ({
      id: sheet.id,
      name: sheet.name,
      primaryFieldId: sheet.primaryFieldId || sheet.primary_field_id || '',
      fields: (sheet.fields || []).map((f: any) => {
        const d = f.data || {};  // v7 字段特有属性嵌套在 data 中
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          required: f.required ?? false,

          // 选择类 (SingleSelect / MultipleSelect)
          items: f.items || d.items || undefined,
          allowAddItemWhileInputting: f.allowAddItemWhileInputting ?? d.allow_add_item_while_inputting ?? undefined,

          // 关联 (Link)
          linkSheet: f.linkSheet || d.link_sheet || undefined,
          linkView: f.linkView || d.link_view || undefined,
          isAuto: f.isAuto ?? d.is_auto ?? undefined,
          multipleLinks: f.multipleLinks ?? d.multiple_links ?? undefined,
          linkFilter: f.linkFilter || d.filter || undefined,

          // 引用 (Lookup)
          linkField: f.linkField || d.link_field || undefined,
          lookupField: f.lookupField || d.lookup_field || undefined,
          aggregation: f.aggregation || d.aggregation || undefined,
          baseType: f.baseType || d.base_type || undefined,
          lookupSheetId: f.lookupSheetId || d.lookup_sheet_id || undefined,

          // 格式控制 (Date/Time/Number/Currency/Percent/Formula/AutoNumber/CreatedTime/LastModifiedTime)
          numberFormat: f.numberFormat || d.number_format || undefined,

          // 公式 (Formula)
          formula: f.formula || d.formula || undefined,
          valueType: f.valueType || d.value_type || undefined,

          // 等级 (Rating)
          maxValue: f.maxValue ?? d.max_value ?? undefined,

          // 唯一性 (MultiLineText / ID / Phone)
          uniqueValue: f.uniqueValue ?? d.unique_value ?? undefined,

          // 默认值 (Date / Contact)
          defaultValueType: f.defaultValueType || d.default_value_type || undefined,
          defaultValue: f.defaultValue || d.default_value || undefined,

          // 超链接 (Url)
          displayText: f.displayText || d.display_text || undefined,

          // 联系人 (Contact)
          multipleContacts: f.multipleContacts ?? d.multiple_contacts ?? undefined,
          noticeNewContact: f.noticeNewContact ?? d.notice_new_contact ?? undefined,

          // 附件 (Attachment)
          onlyUploadByCamera: f.onlyUploadByCamera ?? d.only_upload_by_camera ?? undefined,

          // 地址 (Address)
          addressLevel: f.addressLevel ?? d.address_level ?? undefined,
          detailedAddress: f.detailedAddress ?? d.detailed_address ?? undefined,
          presetAddress: f.presetAddress || d.preset_address || undefined,

          // 最后修改者/时间 (LastModifiedBy / LastModifiedTime)
          watchAll: f.watchAll ?? d.watch_all ?? undefined,
          watchedField: f.watchedField || d.watched_field || undefined,

          // 保留原始 data 对象（兆底）
          data: Object.keys(d).length > 0 ? d : undefined,
        };
      }),
      views: (sheet.views || []).map((v: any) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        filter: v.filter || undefined,
        sort: v.sort || undefined,
        group: v.group || undefined,
      })),
    }));

    return {
      result: 0,
      detail: { sheets },
    };
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
    if (this.apiVersion === 'v7') {
      return this.getRecordsV7(sheetId, options);
    }
    return this.request<RecordListResponse>('/record/list', {
      sheetId,
      pageSize: options?.pageSize ?? 100,
      viewId: options?.viewId,
      fields: options?.fields,
      showFieldsInfo: true,
    });
  }

  /**
   * v7 记录列表获取 + 响应归一化
   * v7: POST /{file_id}/sheets/{sheet_id}/records
   * v3: POST /{file_id}/core/execute/record/list
   */
  private async getRecordsV7(
    sheetId: number,
    options?: { pageSize?: number; viewId?: string; fields?: string[] }
  ): Promise<RecordListResponse> {
    const baseUrl = config.kingsoft.apiBaseUrl || V7_API_BASE;
    const url = `${baseUrl}/${this.fileId}/sheets/${sheetId}/records`;

    const body: Record<string, any> = {
      prefer_id: false,
      show_fields_info: true,
      text_value: 'original',
      page_size: options?.pageSize ?? 100,
    };
    if (options?.viewId) body.view_id = options.viewId;
    if (options?.fields) body.fields = options.fields;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API 请求失败 [/records]: ${response.status} ${response.statusText} - ${text}`);
    }

    const raw = await response.json() as any;
    if (raw.code !== undefined && raw.code !== 0) {
      throw new Error(`API 返回错误 [/records]: code=${raw.code}, msg=${raw.msg}`);
    }

    const v7data = raw.data || {};
    // v7 records 的 fields 可能是 JSON 字符串，需解析
    const records: RecordInfo[] = (v7data.records || []).map((r: any) => ({
      id: r.id,
      fields: typeof r.fields === 'string' ? JSON.parse(r.fields) : (r.fields || {}),
    }));

    const fieldsSchema = (v7data.fields_schema || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
    }));

    return {
      result: 0,
      detail: {
        fieldsSchema,
        offset: v7data.page_token || '',
        records,
      },
    };
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

  /**
   * 获取表单字段配置
   * GET /v7/dbsheet/{file_id}/sheets/{sheet_id}/forms/{view_id}/fields
   * 返回: { form_fields: [{ field_id, title, description, required }] }
   */
  async getFormFields(sheetId: number, viewId: string): Promise<{ field_id: string; title: string; description: string; required: boolean }[]> {
    const baseUrl = config.kingsoft.apiBaseUrl || V7_API_BASE;
    // 注意：表单字段API不在 /coop/ 路径下，使用 /dbsheet/ 路径
    const dbsheetBaseUrl = baseUrl.replace('/coop/dbsheet', '/dbsheet');
    const url = `${dbsheetBaseUrl}/${this.fileId}/sheets/${sheetId}/forms/${viewId}/fields`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API 请求失败 [/forms/${viewId}/fields]: ${response.status} ${response.statusText} - ${text}`);
    }

    const raw = await response.json() as any;
    if (raw.code !== undefined && raw.code !== 0) {
      throw new Error(`API 返回错误 [/forms/${viewId}/fields]: code=${raw.code}, msg=${raw.msg}`);
    }

    const v7data = raw.data || {};
    return v7data.form_fields || [];
  }

  /**
   * 获取 sheet ID 到表名的映射
   */
  async getSheetIdToNameMap(): Promise<Map<number, string>> {
    const tables = await this.getTables();
    const map = new Map<number, string>();
    for (const table of tables) {
      map.set(table.id, table.name);
    }
    return map;
  }

  // ============================================================
  // 底层 HTTP 请求（v7: Bearer JWT / v3: WPS-3 签名）
  // ============================================================

  private async request<T>(action: string, params: Record<string, any>): Promise<T> {
    if (this.apiVersion === 'v7') {
      return this.requestV7<T>(action, params);
    }
    return this.requestV3<T>(action, params);
  }

  /**
   * v7 API — Bearer JWT 鉴权
   *
   * action 映射：
   *   '/schema/query'  → GET  /{file_id}/schema
   *   '/record/list'   → POST /{file_id}/record/list
   */
  private async requestV7<T>(action: string, params: Record<string, any>): Promise<T> {
    const baseUrl = config.kingsoft.apiBaseUrl || V7_API_BASE;

    // 将内部 action 映射为 v7 RESTful 路径
    const routeMap: Record<string, { method: string; path: string }> = {
      '/schema/query': { method: 'GET',  path: `/${this.fileId}/schema` },
      '/record/list':  { method: 'POST', path: `/${this.fileId}/record/list` },
    };

    const route = routeMap[action] || { method: 'POST', path: `/${this.fileId}${action}` };
    const url = `${baseUrl}${route.path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: route.method,
      headers,
    };

    if (route.method === 'POST') {
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API 请求失败 [${action}]: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json() as any;

    // v7 响应格式: { code: 0, msg: "", data: {...} }
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`API 返回错误 [${action}]: code=${data.code}, msg=${data.msg}`);
    }

    return data as T;
  }

  /**
   * v3 API — WPS-3 签名鉴权（兼容旧版）
   */
  private async requestV3<T>(action: string, params: Record<string, any>): Promise<T> {
    const baseUrl = config.kingsoft.apiBaseUrl || V3_API_BASE;
    const url = `${baseUrl}/${this.fileId}/core/execute${action}?access_token=${this.accessToken}`;
    const body = JSON.stringify({ param: params });
    const headers = this.buildV3Headers(body);

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

    if (data.result !== undefined && data.result !== 0) {
      throw new Error(`API 返回错误 [${action}]: result=${data.result}, ${JSON.stringify(data)}`);
    }

    return data;
  }

  /** 构建 WPS-3 签名请求头（仅 v3 使用） */
  private buildV3Headers(body: string): Record<string, string> {
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
 *   或 "fileId:accessToken:apiSecret:v3"  （显式指定旧版鉴权）
 *
 * 默认使用 v7 API（Bearer JWT）。
 * 如果未配置 tableSpaceId，返回 null（将使用 mock 模式）
 */
export function createAdapterFromSpaceId(tableSpaceId: string | null | undefined): KingsoftAdapter | null {
  if (!tableSpaceId) return null;

  const parts = tableSpaceId.split(':');
  if (parts.length < 2) return null;

  const [fileId, accessToken, apiSecret, version] = parts;
  if (!fileId || !accessToken) return null;

  const apiVersion = (version === 'v3' ? 'v3' : 'v7') as 'v3' | 'v7';
  return new KingsoftAdapter(fileId, accessToken, apiSecret, apiVersion);
}
