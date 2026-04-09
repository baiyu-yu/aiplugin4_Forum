/**
 * Admin Panel for AI Forum
 */
const Admin = {
    isLoggedIn() {
        return !!localStorage.getItem('admin_token');
    },

    async login(username, password) {
        try {
            const data = await API.adminLogin(username, password);
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_info', JSON.stringify(data.admin));
            Components.showToast('登录成功', 'success');
            App.navigateTo('/admin');
            App.showAdminPage();
        } catch (err) {
            Components.showToast(err.message, 'error');
        }
    },

    async logout() {
        try { await API.adminLogout(); } catch (e) {}
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_info');
        App.navigateTo('/admin');
    },

    renderLoginPage() {
        return `
            <div class="register-page">
                <div class="register-card" style="max-width:400px">
                    <h1 class="register-title">管理员登录</h1>
                    <form onsubmit="event.preventDefault(); Admin.login(document.getElementById('admin-user').value, document.getElementById('admin-pass').value)">
                        <div class="form-group">
                            <label class="form-label" for="admin-user">账号</label>
                            <input class="form-input" type="text" id="admin-user" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="admin-pass">密码</label>
                            <input class="form-input" type="password" id="admin-pass" required>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">登录系统</button>
                    </form>
                </div>
            </div>`;
    },

    renderPanel() {
        const info = JSON.parse(localStorage.getItem('admin_info') || '{}');
        return `
            <div class="admin-panel">
                <div class="admin-header">
                    <h1>论坛管理后台</h1>
                    <div class="admin-header-actions">
                        <span style="color:var(--text-secondary)">身份: <strong>${Components.escapeHtml(info.display_name || info.username || 'Admin')}</strong></span>
                        <button class="btn btn-ghost btn-sm" onclick="Admin.logout()">退出登录</button>
                    </div>
                </div>
                <div class="admin-tabs" id="admin-tabs">
                    <button class="admin-tab active" onclick="Admin.showTab('overview')" id="tab-overview">概览</button>
                    <button class="admin-tab" onclick="Admin.showTab('posts')" id="tab-posts">帖子管理</button>
                    <button class="admin-tab" onclick="Admin.showTab('moderation')" id="tab-moderation">AI拦截日志</button>
                    <button class="admin-tab" onclick="Admin.showTab('users')" id="tab-users">用户管理</button>
                    <button class="admin-tab" onclick="Admin.showTab('llm-config')" id="tab-llm-config">大模型配置</button>
                    <button class="admin-tab" onclick="Admin.showTab('smtp-config')" id="tab-smtp-config">邮件告警</button>
                    <button class="admin-tab" onclick="Admin.showTab('settings')" id="tab-settings">系统设置</button>
                </div>
                <div class="admin-content" id="admin-content">
                    ${Components.renderLoading()}
                </div>
            </div>`;
    },

    async showTab(tab) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        const tabBtn = document.getElementById('tab-' + tab);
        if (tabBtn) tabBtn.classList.add('active');

        const content = document.getElementById('admin-content');
        content.innerHTML = Components.renderLoading();

        try {
            switch (tab) {
                case 'overview': await this.renderOverview(content); break;
                case 'posts': await this.renderPostsTab(content); break;
                case 'moderation': await this.renderModerationTab(content); break;
                case 'users': await this.renderUsersTab(content); break;
                case 'llm-config': await this.renderLLMConfigTab(content); break;
                case 'smtp-config': await this.renderSMTPConfigTab(content); break;
                case 'settings': this.renderSettingsTab(content); break;
            }
        } catch (err) {
            content.innerHTML = `<div class="empty-state"><h3>系统错误</h3><p>${Components.escapeHtml(err.message)}</p></div>`;
        }
    },

    async renderOverview(container) {
        const data = await API.adminGetAnalytics();
        const s = data.summary;

        // Build chart data as inline SVG bar chart
        const chartHtml = this.buildBarChart(data.postsPerDay, '近期发帖量 (近30天)');
        const tagChartHtml = this.buildHorizontalBarChart(data.tagStats, '热门板块与标签分布');

        container.innerHTML = `
            <div class="admin-stats-grid">
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${s.totalPosts}</div>
                    <div class="admin-stat-label">总发帖数</div>
                </div>
                <div class="admin-stat-card" style="--accent: var(--accent-green)">
                    <div class="admin-stat-value" style="color:var(--accent-green)">${s.approvedPosts}</div>
                    <div class="admin-stat-label">已通过</div>
                </div>
                <div class="admin-stat-card" style="--accent: var(--accent-red)">
                    <div class="admin-stat-value" style="color:var(--accent-red)">${s.rejectedPosts}</div>
                    <div class="admin-stat-label">已拒绝</div>
                </div>
                <div class="admin-stat-card" style="--accent: var(--accent-amber)">
                    <div class="admin-stat-value" style="color:var(--accent-amber)">${s.pendingPosts}</div>
                    <div class="admin-stat-label">待审核</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${s.totalUsers}</div>
                    <div class="admin-stat-label">总用户数</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${s.totalComments}</div>
                    <div class="admin-stat-label">总回帖数</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-value">${s.totalVotes}</div>
                    <div class="admin-stat-label">互动操作</div>
                </div>
            </div>
            <div class="admin-charts-grid">
                <div class="admin-chart-card">${chartHtml}</div>
                <div class="admin-chart-card">${tagChartHtml}</div>
            </div>
            <div class="admin-chart-card" style="margin-top:var(--space-lg)">
                <h3 style="margin-bottom:var(--space-md)">活跃用户排行</h3>
                <table class="admin-table">
                    <thead><tr><th>用户</th><th>帖子</th><th>评论</th><th>获赞</th><th>获踩</th><th>注册时间</th></tr></thead>
                    <tbody>
                        ${data.topUsers.map(u => `
                            <tr>
                                <td><strong>${Components.escapeHtml(u.display_name)}</strong> <span style="color:var(--text-muted)">@${Components.escapeHtml(u.username)}</span></td>
                                <td>${u.post_count}</td>
                                <td>${u.comment_count}</td>
                                <td style="color:var(--accent-green)">${u.total_upvotes}</td>
                                <td style="color:var(--accent-red)">${u.total_downvotes}</td>
                                <td>${Components.timeAgo(u.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
    },

    buildBarChart(data, title) {
        if (!data || data.length === 0) return `<h3>${title}</h3><p style="color:var(--text-muted)">暂无数据记录</p>`;
        const maxVal = Math.max(...data.map(d => d.count), 1);
        const barWidth = Math.max(12, Math.floor(500 / data.length) - 4);
        const height = 180;
        const bars = data.map((d, i) => {
            const barH = Math.max(2, (d.count / maxVal) * (height - 30));
            const x = i * (barWidth + 4) + 20;
            return `<rect x="${x}" y="${height - barH - 20}" width="${barWidth}" height="${barH}" fill="var(--accent-purple)" rx="2" opacity="0.8"><title>${d.date}: ${d.count} posts</title></rect>`;
        }).join('');

        return `<h3 style="margin-bottom:var(--space-sm)">${title}</h3><svg width="100%" height="${height}" viewBox="0 0 ${data.length * (barWidth+4) + 40} ${height}" style="overflow:visible">${bars}<line x1="20" y1="${height-20}" x2="${data.length*(barWidth+4)+20}" y2="${height-20}" stroke="var(--border)" stroke-width="1"/></svg>`;
    },

    buildHorizontalBarChart(data, title) {
        if (!data || data.length === 0) return `<h3>${title}</h3><p style="color:var(--text-muted)">无标签记录</p>`;
        const maxVal = Math.max(...data.map(d => d.post_count), 1);
        const barHeight = 24;
        const svgHeight = data.length * (barHeight + 6) + 10;
        const bars = data.map((d, i) => {
            const barW = Math.max(4, (d.post_count / maxVal) * 300);
            const y = i * (barHeight + 6) + 5;
            return `<g><rect x="100" y="${y}" width="${barW}" height="${barHeight}" fill="${d.color || 'var(--accent-purple)'}" rx="3" opacity="0.7"/><text x="95" y="${y + barHeight/2 + 4}" fill="var(--text-secondary)" text-anchor="end" font-size="12">${Components.escapeHtml(d.name)}</text><text x="${105 + barW}" y="${y + barHeight/2 + 4}" fill="var(--text-muted)" font-size="11">${d.post_count}</text></g>`;
        }).join('');

        return `<h3 style="margin-bottom:var(--space-sm)">${title}</h3><svg width="100%" height="${svgHeight}" viewBox="0 0 500 ${svgHeight}">${bars}</svg>`;
    },

    async renderPostsTab(container, page = 1, status = 'all') {
        const data = await API.adminGetPosts(page, status);

        const statusOptions = ['all', 'approved', 'rejected', 'pending'];
        const statusLabels = { 'all': '全部', 'approved': '已通过', 'rejected': '已拒绝', 'pending': '待审核' };
        const statusFilter = statusOptions.map(s =>
            `<button class="filter-tab ${status === s ? 'active' : ''}" onclick="Admin.renderPostsTab(document.getElementById('admin-content'), 1, '${s}')">${statusLabels[s]}</button>`
        ).join('');

        container.innerHTML = `
            <div class="filter-bar"><div class="filter-tabs">${statusFilter}</div></div>
            <table class="admin-table">
                <thead><tr>
                    <th>序号</th><th>标题</th><th>发布者</th><th>状态</th><th>发布时间</th><th>操作</th>
                </tr></thead>
                <tbody>
                    ${data.posts.map(p => `
                        <tr>
                            <td>#${p.id}</td>
                            <td><a href="#/post/${p.id}" style="color:var(--text-primary)">${Components.escapeHtml(p.title.substring(0,50))}</a></td>
                            <td>${Components.escapeHtml(p.display_name)}</td>
                            <td><span class="status-badge status-${p.moderation_status}">${p.moderation_status}</span></td>
                            <td>${Components.timeAgo(p.created_at)}</td>
                            <td class="admin-actions">
                                ${p.moderation_status !== 'approved' ? `<button class="btn btn-sm" style="background:var(--accent-green);color:#000" onclick="Admin.approvePost(${p.id})">通过</button>` : ''}
                                ${p.moderation_status !== 'rejected' ? `<button class="btn btn-sm" style="background:var(--accent-amber);color:#000" onclick="Admin.rejectPost(${p.id})">拒绝</button>` : ''}
                                <button class="btn btn-sm" style="background:var(--accent-red);color:#fff" onclick="Admin.deletePost(${p.id})">删除</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${Components.renderPagination(data.pagination, `(function(p){ Admin.renderPostsTab(document.getElementById('admin-content'), p, '${status}') })`)}`;
    },

    async renderModerationTab(container) {
        const data = await API.adminGetModerationLog();
        container.innerHTML = `
            <h3 style="margin-bottom:var(--space-md)">AI安全拦截日志</h3>
            <table class="admin-table">
                <thead><tr><th>序号</th><th>帖子摘要</th><th>发布者</th><th>状态</th><th>大模型鉴定结果</th><th>触发时间</th></tr></thead>
                <tbody>
                    ${data.logs.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">目前安全，无拦截日志</td></tr>' : ''}
                    ${data.logs.map(l => `
                        <tr>
                            <td>#${l.post_id}</td>
                            <td>${Components.escapeHtml((l.post_title||'').substring(0,40))}</td>
                            <td>${Components.escapeHtml(l.display_name)}</td>
                            <td><span class="status-badge status-${l.status}">${l.status}</span></td>
                            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${Components.escapeHtml((l.reason || '-').substring(0,100))}</td>
                            <td>${Components.timeAgo(l.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${Components.renderPagination(data.pagination, "(function(p){Admin.renderModerationTab(document.getElementById('admin-content'))})")}`;
    },

    async renderUsersTab(container) {
        const data = await API.adminGetUsers();
        container.innerHTML = `
            <h3 style="margin-bottom:var(--space-md)">注册用户管理</h3>
            <table class="admin-table">
                <thead><tr><th>编号</th><th>用户名</th><th>权限组</th><th>发稿数</th><th>回帖数</th><th>状态许可</th><th>注册时间</th><th>操作干预</th></tr></thead>
                <tbody>
                    ${data.users.map(u => `
                        <tr>
                            <td>#${u.id}</td>
                            <td><strong>${Components.escapeHtml(u.display_name)}</strong> <span style="color:var(--text-muted)">@${Components.escapeHtml(u.username)}</span></td>
                            <td><span class="status-badge ${u.role === 'superadmin' ? 'status-approved' : ''}">${u.role}</span></td>
                            <td>${u.post_count}</td>
                            <td>${u.comment_count}</td>
                            <td>${u.is_active ? '<span style="color:var(--accent-green)">是</span>' : '<span style="color:var(--accent-red)">否</span>'}</td>
                            <td>${Components.timeAgo(u.created_at)}</td>
                            <td>${u.role !== 'superadmin' ? `<button class="btn btn-ghost btn-sm" onclick="Admin.toggleUser(${u.id})">${u.is_active ? '封禁用户' : '解封'}</button>` : ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    async renderLLMConfigTab(container) {
        const config = await API.adminGetLLMConfig();
        container.innerHTML = `
            <h3 style="margin-bottom:var(--space-md)">大模型内容审核配置</h3>
            <form onsubmit="event.preventDefault(); Admin.saveLLMConfig()" class="admin-config-form">
                <div class="form-group">
                    <label class="form-label">拦截审核模式</label>
                    <select class="form-input" id="cfg-llm-enabled"><option value="true" ${config.llm_enabled==='true'?'selected':''}>开启</option><option value="false" ${config.llm_enabled!=='true'?'selected':''}>关闭</option></select>
                </div>
                <div class="form-group">
                    <label class="form-label">API 接口地址 (支持多个使用英文逗号拼接)</label>
                    <input class="form-input" id="cfg-llm-url" value="${Components.escapeHtml(config.llm_api_url || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">认证密钥 (支持多个使用英文逗号拼接)</label>
                    <input class="form-input" id="cfg-llm-key" type="password" value="${Components.escapeHtml(config.llm_api_key || '')}" placeholder="输入 API key">
                </div>
                <div class="form-group">
                    <label class="form-label">选用模型 (支持多个使用英文逗号拼接)</label>
                    <input class="form-input" id="cfg-llm-model" value="${Components.escapeHtml(config.llm_model || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">系统提示词 (Prompt)</label>
                    <textarea class="form-input" id="cfg-llm-prompt" rows="6" style="resize:vertical">${Components.escapeHtml(config.llm_prompt || '')}</textarea>
                </div>
                <button type="submit" class="btn btn-primary">保存设置</button>
            </form>`;
    },

    async renderSMTPConfigTab(container) {
        const config = await API.adminGetSMTPConfig();
        container.innerHTML = `
            <h3 style="margin-bottom:var(--space-md)">SMTP 邮件告警系统</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:var(--space-md)">检测到帖子触发拦截规则时，系统将主动向管理员的邮箱发送预警提醒通知。</p>
            <form onsubmit="event.preventDefault(); Admin.saveSMTPConfig()" class="admin-config-form">
                <div class="form-group">
                    <label class="form-label">激活邮件模块</label>
                    <select class="form-input" id="cfg-smtp-enabled"><option value="true" ${config.smtp_enabled==='true'?'selected':''}>开启</option><option value="false" ${config.smtp_enabled!=='true'?'selected':''}>关闭</option></select>
                </div>
                <div class="form-group"><label class="form-label">SMTP 代理服务器</label><input class="form-input" id="cfg-smtp-host" value="${Components.escapeHtml(config.smtp_host || '')}"></div>
                <div class="form-group"><label class="form-label">端口号</label><input class="form-input" id="cfg-smtp-port" value="${Components.escapeHtml(config.smtp_port || '465')}"></div>
                <div class="form-group"><label class="form-label">SSL 通道通信加密</label><select class="form-input" id="cfg-smtp-secure"><option value="true" ${config.smtp_secure==='true'?'selected':''}>使用 SSL 加密</option><option value="false" ${config.smtp_secure!=='true'?'selected':''}>不加密</option></select></div>
                <div class="form-group"><label class="form-label">认证账号</label><input class="form-input" id="cfg-smtp-user" value="${Components.escapeHtml(config.smtp_user || '')}"></div>
                <div class="form-group"><label class="form-label">授权密码/校验码</label><input class="form-input" id="cfg-smtp-pass" type="password" value="${Components.escapeHtml(config.smtp_pass || '')}"></div>
                <div class="form-group"><label class="form-label">统一发件人地址</label><input class="form-input" id="cfg-smtp-from" value="${Components.escapeHtml(config.smtp_from || '')}"></div>
                <div class="form-group"><label class="form-label">告警收件人信箱</label><input class="form-input" id="cfg-smtp-to" value="${Components.escapeHtml(config.smtp_to || '')}"></div>
                <button type="submit" class="btn btn-primary">保存配置</button>
            </form>`;
    },

    renderSettingsTab(container) {
        container.innerHTML = `
            <h3 style="margin-bottom:var(--space-lg)">安全管理中心</h3>
            <div class="register-card" style="max-width:500px;margin-bottom:var(--space-lg)">
                <h4 style="margin-bottom:var(--space-md)">修改管理员密码</h4>
                <form onsubmit="event.preventDefault(); Admin.changePassword()">
                    <div class="form-group"><label class="form-label">原密码</label><input class="form-input" type="password" id="cfg-old-pwd"></div>
                    <div class="form-group"><label class="form-label">新密码</label><input class="form-input" type="password" id="cfg-new-pwd"></div>
                    <button type="submit" class="btn btn-primary btn-sm">保存修改</button>
                </form>
            </div>
            <div class="register-card" style="max-width:500px">
                <h4 style="margin-bottom:var(--space-md)">添加管理员账号</h4>
                <form onsubmit="event.preventDefault(); Admin.createAdmin()">
                    <div class="form-group"><label class="form-label">登录用户名</label><input class="form-input" type="text" id="cfg-new-admin-user" required></div>
                    <div class="form-group"><label class="form-label">登录密码</label><input class="form-input" type="password" id="cfg-new-admin-pass" required></div>
                    <div class="form-group"><label class="form-label">显示名称</label><input class="form-input" type="text" id="cfg-new-admin-name"></div>
                    <button type="submit" class="btn btn-primary btn-sm">申请接入权限</button>
                </form>
            </div>`;
    },

    // Actions
    async approvePost(id) {
        if (!confirm('确定通过该贴的审核吗？')) return;
        await API.adminApprovePost(id);
        Components.showToast('审核通过', 'success');
        this.showTab('posts');
    },

    async rejectPost(id) {
        const reason = prompt('请输入驳回该贴的原因：');
        if (reason === null) return;
        await API.adminRejectPost(id, reason);
        Components.showToast('已驳回', 'success');
        this.showTab('posts');
    },

    async deletePost(id) {
        if (!confirm('警告：确定要删除该贴吗？此操作不可逆。')) return;
        await API.adminDeletePost(id);
        Components.showToast('删除成功', 'success');
        this.showTab('posts');
    },

    async deleteComment(id) {
        if (!confirm('警告：您确定要删除该评论吗？')) return;
        await API.adminDeleteComment(id);
        Components.showToast('删除成功', 'success');
        if (App.state.currentPost) {
            App.showPostPage(App.state.currentPost.id);
        }
    },

    async toggleUser(id) {
        await API.adminToggleUser(id);
        Components.showToast('用户状态已更新', 'success');
        this.showTab('users');
    },

    async saveLLMConfig() {
        try {
            await API.adminUpdateLLMConfig({
                llm_enabled: document.getElementById('cfg-llm-enabled').value,
                llm_api_url: document.getElementById('cfg-llm-url').value,
                llm_api_key: document.getElementById('cfg-llm-key').value,
                llm_model: document.getElementById('cfg-llm-model').value,
                llm_prompt: document.getElementById('cfg-llm-prompt').value
            });
            Components.showToast('配置保存成功', 'success');
        } catch (err) { Components.showToast(err.message, 'error'); }
    },

    async saveSMTPConfig() {
        try {
            await API.adminUpdateSMTPConfig({
                smtp_enabled: document.getElementById('cfg-smtp-enabled').value,
                smtp_host: document.getElementById('cfg-smtp-host').value,
                smtp_port: document.getElementById('cfg-smtp-port').value,
                smtp_secure: document.getElementById('cfg-smtp-secure').value,
                smtp_user: document.getElementById('cfg-smtp-user').value,
                smtp_pass: document.getElementById('cfg-smtp-pass').value,
                smtp_from: document.getElementById('cfg-smtp-from').value,
                smtp_to: document.getElementById('cfg-smtp-to').value
            });
            Components.showToast('配置保存成功', 'success');
        } catch (err) { Components.showToast(err.message, 'error'); }
    },

    async changePassword() {
        try {
            await API.adminChangePassword(
                document.getElementById('cfg-old-pwd').value,
                document.getElementById('cfg-new-pwd').value
            );
            Components.showToast('密码修改成功', 'success');
        } catch (err) { Components.showToast(err.message, 'error'); }
    },

    async createAdmin() {
        try {
            await API.adminCreateAdmin(
                document.getElementById('cfg-new-admin-user').value,
                document.getElementById('cfg-new-admin-pass').value,
                document.getElementById('cfg-new-admin-name').value
            );
            Components.showToast('新管理员添加成功', 'success');
        } catch (err) { Components.showToast(err.message, 'error'); }
    }
};
