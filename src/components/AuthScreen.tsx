/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 登录 / 注册页
 * ---------------------------------------------------------------------------
 * 后端所有业务端点都要求会话（HttpOnly Cookie），所以未登录时前端只显示这张卡。
 * 密码只在这一层存在，提交后由服务端 argon2id 哈希存库，前端不留存。
 */

import React, { useState } from 'react';
import { Sparkles, LogIn, UserPlus, Loader2, AlertTriangle } from 'lucide-react';

import { AuthService, type AuthUser } from '../services/authService';
import { describeError } from '../services/apiClient';

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    setError(null);
    setIsBusy(true);
    try {
      const user =
        mode === 'login'
          ? await AuthService.login(email.trim(), password)
          : await AuthService.register(email.trim(), password, name.trim());
      onAuthenticated(user);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight">
              AI PPT Studio
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              AI 原生演示文稿工作台
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          data-testid="auth-form"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 space-y-4"
        >
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              data-testid="auth-tab-login"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" /> 登录
            </button>
            <button
              type="button"
              data-testid="auth-tab-register"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" /> 注册
            </button>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                昵称
              </label>
              <input
                type="text"
                data-testid="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="可选"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              邮箱
            </label>
            <input
              type="email"
              required
              data-testid="auth-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              密码
            </label>
            <input
              type="password"
              required
              data-testid="auth-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          {error && (
            <div
              data-testid="auth-error"
              className="flex items-start gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isBusy}
            data-testid="auth-submit"
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold transition-all flex items-center justify-center gap-2"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> 处理中…
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" /> 登录
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" /> 创建账号
              </>
            )}
          </button>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            会话由服务端签发的 HttpOnly Cookie 承载，密码经 argon2id 哈希后存库。
          </p>
        </form>
      </div>
    </div>
  );
};
