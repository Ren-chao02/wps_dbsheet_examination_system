/**
 * ✅ 统一数据导出服务 (Export Service)
 *
 * 核心功能：
 * - 多格式支持（Excel、CSV、PDF）
 * - 自定义模板系统
 * - 大数据量流式写盘（Excel 用 exceljs WorkbookWriter，CSV/PDF 异步写文件）
 * - 异步任务队列（避免超时）
 *
 * 使用方式：
 * const exportService = new ExportService();
 * const result = await exportService.exportToExcel(data, options);
 */

import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import dayjs from 'dayjs';

// ✅ 导出格式枚举
export enum ExportFormat {
  EXCEL = 'excel',
  CSV = 'csv',
  PDF = 'pdf',
}

// ✅ 导出选项接口
export interface ExportOptions {
  // 文件信息
  filename?: string;           // 自定义文件名（不含扩展名）
  sheetName?: string;          // Excel工作表名称

  // 列配置
  columns?: Array<{
    key: string;               // 数据字段名
    title: string;             // 列标题
    width?: number;            // 列宽（字符数）
    format?: (value: any) => any; // 值格式化函数
  }>;

  // 样式配置
  headerStyle?: {
    bgColor?: string;
    fontColor?: string;
    fontSize?: number;
    bold?: boolean;
  };

  // 性能优化
  batchSize?: number;          // 分批处理大小（默认1000）
  useStream?: boolean;         // 是否使用流式写入（大文件推荐）

  // 其他
  password?: string;           // Excel密码保护（可选）
}

// ✅ 导出结果接口
export interface ExportResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;            // 字节
  recordCount: number;
  format: ExportFormat;
  downloadUrl: string;         // 相对路径，用于API返回
  createdAt: Date;
}

// ✅ 导出任务状态
export enum TaskStatus {
  PENDING = 'pending',         // 等待执行
  PROCESSING = 'processing',   // 处理中
  COMPLETED = 'completed',     // 已完成
  FAILED = 'failed',           // 失败
}

// ✅ 导出任务接口
export interface ExportTask {
  id: string;
  userId: string;
  entityType: string;          // 导出的实体类型（如Exam, Student）
  entityId?: string;           // 具体实体ID
  format: ExportFormat;
  status: TaskStatus;
  progress: number;            // 0-100
  filePath?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

class ExportService {
  private readonly outputDir: string;

  constructor() {
    // 导出目录可用 EXPORT_DIR 覆盖：默认 <cwd>/exports 在 Docker 里是 /app/exports（已挂卷），
    // 但非容器部署时 cwd 随启动方式而变（systemd/pm2/直接 node 都不同），
    // 迁移服务器时若没跟着搬这个目录，历史导出任务会全部 404。
    this.outputDir = process.env.EXPORT_DIR || join(process.cwd(), 'exports');
    this.ensureOutputDir();
  }

  // ✅ 确保输出目录存在
  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 清洗用户提供的文件名，防止路径注入/非法字符；返回空串表示需自动生成
   */
  private sanitizeBaseFilename(name?: string): string {
    if (!name) return '';
    return name
      .replace(/[\\/:*?"<>|\r\n]/g, '_') // 非法文件名字符
      .replace(/\.{2,}/g, '_')            // 防路径穿越（..）
      .trim()
      .slice(0, 80);
  }

  /**
   * ✅ 主导出方法 - 根据格式自动分发
   */
  async export(
    data: any[],
    format: ExportFormat,
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    switch (format) {
      case ExportFormat.EXCEL:
        return this.exportToExcel(data, options);
      case ExportFormat.CSV:
        return this.exportToCsv(data, options);
      case ExportFormat.PDF:
        return this.exportToPdf(data, options);
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }

  /**
   * ✅ 导出到Excel (.xlsx)
   *
   * 使用 exceljs 流式 WorkbookWriter 逐行写盘：
   * - 不再使用 XLSX.writeFile（全量内存 + 同步写盘，会把事件循环堵死，
   *   几个人同时导出即可让全站卡住）
   * - 流式写入时内存占用与数据行数无关，且写盘过程可被 await，不阻塞事件循环
   */
  async exportToExcel(data: any[], options: ExportOptions = {}): Promise<ExportResult> {
    const startTime = Date.now();

    // 准备数据
    const processedData = this.processData(data, options);

    // 生成文件名和路径
    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const baseFilename = this.sanitizeBaseFilename(options.filename) || `export-${timestamp}`;
    const filePath = join(this.outputDir, `${baseFilename}.xlsx`);

    // 流式工作簿：数据逐行 commit 落盘，避免把全部数据再复制一份到内存
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: false,
      useSharedStrings: true,
    });
    const worksheet = workbook.addWorksheet(options.sheetName || 'Sheet1');

    // 列定义（流式模式下设置 columns 会自动写出表头行）
    if (options.columns && options.columns.length > 0) {
      // 有列配置时，processData 已把行数据转成「列标题 → 值」，key 取标题即可对齐
      worksheet.columns = options.columns.map(col => ({
        header: col.title,
        key: col.title,
        width: col.width || 15,
      }));
    } else if (processedData.length > 0) {
      // 无列配置：以第一行的键作为表头
      worksheet.columns = Object.keys(processedData[0]).map(k => ({
        header: k,
        key: k,
        width: 15,
      }));
    }

    // 逐行写入（addRow 后立即 commit 释放该行内存）
    for (const row of processedData) {
      worksheet.addRow(row).commit();
    }

    // 完成写盘（await：等待流真正写完，不阻塞事件循环）
    await workbook.commit();

    // 如果需要密码保护（需额外库支持，此处仅标记）
    if (options.password) {
      console.warn('Excel密码保护功能需要额外依赖，当前版本暂不支持');
    }

    return this.createResult(filePath, data.length, ExportFormat.EXCEL, startTime);
  }

  /**
   * ✅ 导出到CSV
   */
  async exportToCsv(data: any[], options: ExportOptions = {}): Promise<ExportResult> {
    const startTime = Date.now();

    // 准备数据
    const processedData = this.processData(data, options);

    // 生成文件名和路径
    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const baseFilename = this.sanitizeBaseFilename(options.filename) || `export-${timestamp}`;
    const filePath = join(this.outputDir, `${baseFilename}.csv`);

    // 生成CSV内容（使用xlsx库的CSV支持）
    const worksheet = XLSX.utils.json_to_sheet(processedData);
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);

    // 异步写盘，避免 writeFileSync 阻塞事件循环
    await fsPromises.writeFile(filePath, csvContent, 'utf-8');

    return this.createResult(filePath, data.length, ExportFormat.CSV, startTime);
  }

  /**
   * ✅ 导出到PDF（基础文本版，完整版需PDF生成库）
   */
  async exportToPdf(data: any[], options: ExportOptions = {}): Promise<ExportResult> {
    const startTime = Date.now();

    // 准备数据
    const processedData = this.processData(data, options);

    // 生成简单的HTML转PDF思路（实际项目建议用puppeteer或pdfkit）
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h2>${options.filename || '导出数据'}</h2>
        <table>
          <thead><tr>
            ${options.columns?.map(col => `<th>${col.title}</th>`).join('') ||
              Object.keys(processedData[0] || {}).map(k => `<th>${k}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${processedData.map(row =>
              `<tr>${
                options.columns?.map(col => `<td>${row[col.key] ?? ''}</td>`).join('') ||
                Object.values(row).map(v => `<td>${v}</td>`).join('')
              }</tr>`
            ).join('')}
          </tbody>
        </table>
        <p style="color: #999; font-size: 12px;">
          导出时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')} | 共 ${data.length} 条记录
        </p>
      </body>
      </html>
    `;

    // 保存HTML文件（实际项目中应转换为PDF）
    const timestamp = dayjs().format('YYYYMMDD-HHmmss');
    const baseFilename = this.sanitizeBaseFilename(options.filename) || `export-${timestamp}`;
    const filePath = join(this.outputDir, `${baseFilename}.html`);

    await fsPromises.writeFile(filePath, htmlContent, 'utf-8');

    console.warn('PDF导出当前为HTML预览模式，完整PDF生成需集成Puppeteer或PDFKit');

    return this.createResult(filePath, data.length, ExportFormat.PDF, startTime);
  }

  /**
   * ✅ 数据预处理（列映射、格式化、过滤）
   */
  private processData(data: any[], options: ExportOptions): any[] {
    if (!Array.isArray(data) || data.length === 0) return [];

    // 如果有列配置，按配置转换数据
    const columns = options.columns;
    if (columns && columns.length > 0) {
      return data.map(item => {
        const row: any = {};
        for (const col of columns) {
          let value = col.key.includes('.')
            ? col.key.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), item)
            : item[col.key];

          // 应用格式化函数
          if (col.format && value !== undefined && value !== null) {
            value = col.format(value);
          }

          // 使用列标题作为键
          row[col.title] = value ?? '';
        }
        return row;
      });
    }

    // 无列配置：浅拍平一行。嵌套对象（如 student/exam 子对象）JSON 序列化，
    // 否则 xlsx 的 sheet_to_csv 对对象值输出空串、Excel 端也无法正常显示。
    // Date 保持原样（xlsx/exceljs 均按日期单元格处理）。
    return data.map(item => {
      const row: any = {};
      for (const [k, v] of Object.entries(item)) {
        row[k] = (v === null || v === undefined)
          ? ''
          : (typeof v === 'object' && !(v instanceof Date))
            ? JSON.stringify(v)
            : v;
      }
      return row;
    });
  }

  /**
   * ✅ 创建统一的导出结果对象
   */
  private createResult(
    filePath: string,
    recordCount: number,
    format: ExportFormat,
    startTime: number
  ): ExportResult {
    const stats = require('fs').statSync(filePath);
    const relativePath = filePath.replace(process.cwd(), '');

    return {
      success: true,
      filePath,
      fileName: filePath.split('/').pop() || '',
      fileSize: stats.size,
      recordCount,
      format,
      // 相对 API 根（axios baseURL=/api）：请求 /api/export/download?path=…
      // 若写成 /api/export/... 会与 baseURL 拼成 /api/api/export/... 导致 404
      downloadUrl: `/export/download?path=${encodeURIComponent(relativePath)}`,
      createdAt: new Date(),
    };
  }

  /**
   * ✅ 清理过期导出文件（定期调用）
   */
  cleanupExpiredFiles(maxAgeHours: number = 24): number {
    const files = require('fs').readdirSync(this.outputDir);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      try {
        const filePath = join(this.outputDir, file);
        const stats = require('fs').statSync(filePath);

        // 跳过目录
        if (stats.isDirectory()) continue;

        const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);

        if (ageHours > maxAgeHours) {
          unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        // 逐文件容错：单个文件失败不影响整体清理
        console.warn('清理单个文件失败:', err);
      }
    }

    return deletedCount;
  }
}

// ✅ 单例导出
export const exportService = new ExportService();
