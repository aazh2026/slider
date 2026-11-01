/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 认证服务（docs/backend-design.md §5.2 / §9.2）
 * ---------------------------------------------------------------------------
 *   POST /api/auth/register   注册 → 直接下发会话 Cookie
 *   POST /api/auth/login      登录 → 下发会话 Cookie
 *   POST /api/auth/logout     登出 → 服务端作废会话
 *   GET  /api/auth/me         当前用户 + 配额
 *
 * 前端**不持有密码**（更不持有 token）—— 会话完全由 HttpOnly Cookie 承载，
 * JS 读不到，所以 XSS 偷不走会话。
 */

import { api } from './apiClient';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthQuota {
  monthlyTokenBudget: number;
  monthlyCostBudget: number;
}

export interface AuthSession {
  user: AuthUser;
  quota?: AuthQuota;
}

export const AuthService = {
  /** 注册 —— 成功后浏览器已经带上会话 Cookie */
  async register(email: string, password: string, name?: string): Promise<AuthUser> {
    const data = await api.post<{ user: AuthUser }>('/api/auth/register', {
      email,
      password,
      name: name?.trim() || undefined,
    });
    return data.user;
  },

  /** 登录 */
  async login(email: string, password: string): Promise<AuthUser> {
    const data = await api.post<{ user: AuthUser }>('/api/auth/login', { email, password });
    return data.user;
  },

  /** 登出 */
  async logout(): Promise<void> {
    await api.post<{ loggedOut: boolean }>('/api/auth/logout');
  },

  /** 当前用户 —— 未登录时后端返回 401，这里返回 null 而不是抛错 */
  async me(): Promise<AuthUser | null> {
    try {
      const data = await api.get<{ user: AuthUser; quota: AuthQuota }>('/api/auth/me');
      return data.user;
    } catch (err) {
      // 只有 401 算"没登录"；网络错误应当上抛，不能被伪装成"未登录"
      const status = (err as { status?: number }).status;
      if (status === 401) return null;
      throw err;
    }
  },
};
