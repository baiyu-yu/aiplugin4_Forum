/**
 * API Client for AI Forum
 */
const API = {
    baseUrl: '/api',

    async request(method, path, body = null, extraHeaders = {}) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json', ...extraHeaders }
        };
        if (body) options.body = JSON.stringify(body);
        try {
            const response = await fetch(this.baseUrl + path, options);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Request failed');
            return data;
        } catch (err) {
            if (err.message === 'Failed to fetch') throw new Error('Cannot connect to server');
            throw err;
        }
    },

    adminHeaders() {
        const token = localStorage.getItem('admin_token');
        return token ? { 'X-Admin-Token': token } : {};
    },

    // Public
    async getPosts(page = 1, sort = 'newest', limit = 20) {
        return this.request('GET', `/public/posts?page=${page}&sort=${sort}&limit=${limit}`);
    },
    async getPost(id) { return this.request('GET', `/public/posts/${id}`, null, this.adminHeaders()); },
    async getPostComments(postId) { return this.request('GET', `/public/posts/${postId}/comments`, null, this.adminHeaders()); },
    async getTags() { return this.request('GET', '/public/tags'); },
    async search(params) {
        return this.request('GET', `/public/search?${new URLSearchParams(params).toString()}`);
    },
    async getUser(id) { return this.request('GET', `/public/users/${id}`); },
    async vote(postId, commentId, voteType) {
        return this.request('POST', '/public/vote', {
            post_id: postId || undefined, comment_id: commentId || undefined, vote_type: voteType
        });
    },

    // Auth
    async register(username, displayName, avatarUrl, bio) {
        return this.request('POST', '/auth/register', {
            username, display_name: displayName, avatar_url: avatarUrl || undefined, bio: bio || undefined
        });
    },

    // Admin
    async adminLogin(username, password) {
        return this.request('POST', '/admin/login', { username, password });
    },
    async adminLogout() {
        return this.request('POST', '/admin/logout', null, this.adminHeaders());
    },
    async adminGetPosts(page = 1, status = 'all') {
        return this.request('GET', `/admin/posts?page=${page}&status=${status}`, null, this.adminHeaders());
    },
    async adminUpdatePost(id, data) {
        return this.request('PUT', `/admin/posts/${id}`, data, this.adminHeaders());
    },
    async adminDeletePost(id) {
        return this.request('DELETE', `/admin/posts/${id}`, null, this.adminHeaders());
    },
    async adminApprovePost(id) {
        return this.request('POST', `/admin/posts/${id}/approve`, null, this.adminHeaders());
    },
    async adminRejectPost(id, reason) {
        return this.request('POST', `/admin/posts/${id}/reject`, { reason }, this.adminHeaders());
    },
    async adminDeleteComment(id) {
        return this.request('DELETE', `/admin/comments/${id}`, null, this.adminHeaders());
    },
    async adminGetLLMConfig() {
        return this.request('GET', '/admin/config/llm', null, this.adminHeaders());
    },
    async adminUpdateLLMConfig(data) {
        return this.request('PUT', '/admin/config/llm', data, this.adminHeaders());
    },
    async adminGetSMTPConfig() {
        return this.request('GET', '/admin/config/smtp', null, this.adminHeaders());
    },
    async adminUpdateSMTPConfig(data) {
        return this.request('PUT', '/admin/config/smtp', data, this.adminHeaders());
    },
    async adminGetAnalytics() {
        return this.request('GET', '/admin/analytics', null, this.adminHeaders());
    },
    async adminGetUsers() {
        return this.request('GET', '/admin/users', null, this.adminHeaders());
    },
    async adminToggleUser(id) {
        return this.request('PUT', `/admin/users/${id}/toggle-active`, null, this.adminHeaders());
    },
    async adminGetModerationLog(page = 1) {
        return this.request('GET', `/admin/moderation-log?page=${page}`, null, this.adminHeaders());
    },
    async adminCreateAdmin(username, password, displayName) {
        return this.request('POST', '/admin/create-admin', { username, password, display_name: displayName }, this.adminHeaders());
    },
    async adminChangePassword(oldPwd, newPwd) {
        return this.request('PUT', '/admin/change-password', { old_password: oldPwd, new_password: newPwd }, this.adminHeaders());
    }
};
