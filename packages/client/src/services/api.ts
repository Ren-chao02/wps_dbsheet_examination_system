import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Request interceptor: attach JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        // 考试中遇到 401（服务端重启换密钥/账号被禁用）会整页跳走、丢失当前题与切屏计数。
        // 这里先把当前 URL 存进 sessionStorage，登录成功后跳回（key: login_return_url，
        // 由 LoginPage 消费：登录成功后读取并清除、navigate 回去，未接入前只存不用）。
        try {
          sessionStorage.setItem(
            'login_return_url',
            window.location.pathname + window.location.search + window.location.hash
          );
        } catch {
          // 隐私模式下 sessionStorage 可能不可用：忽略，仅丢失回跳能力
        }
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ============================================================
// 题库练习（实操模式）
// ============================================================

export const practiceApi = {
  /** 查询当前学生的练习文件注册 */
  getAssignment: () => api.get('/practice/assignment').then(r => r.data),

  /** 注册/更新练习文件（教师/管理员代学生注册） */
  registerAssignment: (data: { fileId: string; shareUrl?: string; accessToken?: string }) =>
    api.post('/practice/assignment', data).then(r => r.data),

  /** 获取分类/难度目录 */
  getCatalog: () => api.get('/practice/questions/catalog').then(r => r.data),

  /** 开练：按分类/难度随机抽题，或个人题集按指定题目（questionIds）组卷 */
  start: (data: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    count?: number;
    questionIds?: string[];
  }) => api.post('/practice/start', data).then(r => r.data),

  /** 提交练习并判分 */
  submit: (recordId: string) =>
    api.post(`/practice/${recordId}/submit`).then(r => r.data),

  /** 练习历史 */
  history: () => api.get('/practice/history').then(r => r.data),

  /** 切换收藏：返回 { favorited: boolean } */
  toggleFavorite: (questionId: string) =>
    api.post('/practice/favorite', { questionId }).then(r => r.data),

  /** 我的收藏列表 */
  favorites: () => api.get('/practice/favorite').then(r => r.data),

  /** 错题本列表 */
  wrongQuestions: () => api.get('/practice/wrong').then(r => r.data),
};
