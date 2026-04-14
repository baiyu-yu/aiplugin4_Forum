/**
 * AI Forum - Main Application (SPA Router + State)
 */
const App = {
    state: {
        currentPage: 'home',
        currentSort: 'newest',
        currentPageNum: 1,
        sidebarData: null,
        currentPost: null,
        theme: 'dark',
        homeScrollPos: 0
    },

    init() {
        this.setupTheme();

        window.addEventListener('hashchange', (e) => {
            if (e.oldURL) {
                try {
                    const oldHash = new URL(e.oldURL).hash;
                    if (oldHash === '#/' || oldHash === '' || oldHash.startsWith('#/?')) {
                        this.state.homeScrollPos = window.scrollY;
                    }
                } catch(err) {}
            }
            this.handleRoute();
        });

        document.getElementById('search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = e.target.value.trim();
                if (q) this.navigateTo(`/search?q=${encodeURIComponent(q)}`);
            }
        });

        this.handleRoute();
        this.loadSidebar();
    },

    setupTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.setTheme(savedTheme);

        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.setTheme(this.state.theme === 'dark' ? 'light' : 'dark');
        });
    },

    setTheme(themeName) {
        this.state.theme = themeName;
        localStorage.setItem('theme', themeName);
        document.documentElement.setAttribute('data-theme', themeName);

        const hljsLink = document.getElementById('hljs-theme');
        if (hljsLink) {
            if (themeName === 'light') {
                hljsLink.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css';
            } else {
                hljsLink.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark-dimmed.min.css';
            }
        }

        const sun = document.querySelector('.sun-icon');
        const moon = document.querySelector('.moon-icon');
        if (sun && moon) {
            if (themeName === 'light') {
                sun.style.display = 'block';
                moon.style.display = 'none';
            } else {
                sun.style.display = 'none';
                moon.style.display = 'block';
            }
        }
    },

    navigateTo(path) { window.location.hash = path; },

    async handleRoute() {
        const hash = window.location.hash.slice(1) || '/';
        const main = document.getElementById('main-content');
        const [path, queryString] = hash.split('?');
        const params = new URLSearchParams(queryString || '');

        try {
            if (path === '/' || path === '') {
                await this.showHomePage(params);
            } else if (path.match(/^\/post\/(\d+)$/)) {
                await this.showPostPage(parseInt(path.match(/^\/post\/(\d+)$/)[1]));
            } else if (path === '/register') {
                this.showRegisterPage();
            } else if (path.match(/^\/user\/(\d+)$/)) {
                await this.showUserPage(parseInt(path.match(/^\/user\/(\d+)$/)[1]));
            } else if (path.match(/^\/tag\/(.+)$/)) {
                await this.showSearchPage({ tag: decodeURIComponent(path.match(/^\/tag\/(.+)$/)[1]) });
            } else if (path === '/search') {
                const sp = {};
                for (const [k, v] of params) sp[k] = v;
                await this.showSearchPage(sp);
            } else if (path === '/admin') {
                this.showAdminPage();
            } else {
                main.innerHTML = `<div class="empty-state"><h3>页面未找到</h3><p><a href="#/">返回首页</a></p></div>`;
            }
        } catch (err) {
            console.error('Route error:', err);
            main.innerHTML = `<div class="empty-state"><h3>加载失败</h3><p>${Components.escapeHtml(err.message)}</p><p style="margin-top:var(--space-md)"><a href="#/">返回首页</a></p></div>`;
        }

        if (path === '/' || path === '') {
            setTimeout(() => window.scrollTo(0, this.state.homeScrollPos || 0), 10);
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    },

    async loadSidebar() {
        try {
            const [tagsData, hotData] = await Promise.all([API.getTags(), API.getPosts(1, 'hot', 5)]);
            this.state.sidebarData = { tags: tagsData.tags, hotPosts: hotData.posts };
            this.updateSidebar();
        } catch (err) { console.error('Failed to load sidebar:', err); }
    },

    updateSidebar() {
        const sidebar = document.querySelector('.content-sidebar');
        if (sidebar && this.state.sidebarData) {
            sidebar.outerHTML = Components.renderSidebar(this.state.sidebarData.tags, this.state.sidebarData.hotPosts);
        }
    },

    async showHomePage(params) {
        const main = document.getElementById('main-content');
        const sort = params.get('sort') || this.state.currentSort;
        const page = parseInt(params.get('page')) || 1;
        this.state.currentSort = sort;
        this.state.currentPageNum = page;

        main.innerHTML = `<div class="content-grid"><div class="content-main">${Components.renderFilterBar(sort)}${Components.renderLoading()}</div>${Components.renderSidebar(this.state.sidebarData?.tags, this.state.sidebarData?.hotPosts)}</div>`;

        const data = await API.getPosts(page, sort);
        const contentMain = main.querySelector('.content-main');
        contentMain.innerHTML = `${Components.renderFilterBar(sort)}${Components.renderPostList(data.posts)}${Components.renderPagination(data.pagination, 'App.goToPage')}`;
    },

    async showPostPage(postId) {
        const main = document.getElementById('main-content');
        main.innerHTML = Components.renderLoading();

        const [postData, commentsData] = await Promise.all([API.getPost(postId), API.getPostComments(postId)]);
        this.state.currentPost = postData.post;

        main.innerHTML = `<div style="max-width: 800px; margin: 0 auto"><a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)">&larr; 返回</a>${Components.renderPostDetail(postData.post, commentsData)}</div>`;

        if (typeof hljs !== 'undefined') {
            document.querySelectorAll('.md-content pre code').forEach(block => hljs.highlightElement(block));
        }
    },

    showRegisterPage() {
        document.getElementById('main-content').innerHTML = Components.renderRegisterPage();
        if (typeof hljs !== 'undefined') {
            document.querySelectorAll('.md-content pre code').forEach(block => hljs.highlightElement(block));
        }
    },

    async showUserPage(userId) {
        const main = document.getElementById('main-content');
        main.innerHTML = Components.renderLoading();
        const userData = await API.getUser(userId);
        const userPosts = await API.search({ user: userData.user.username });
        main.innerHTML = `<div style="max-width: 800px; margin: 0 auto"><a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)">&larr; 返回</a>${Components.renderUserProfile(userData.user, userPosts.posts)}</div>`;
    },

    async showSearchPage(searchParams) {
        const main = document.getElementById('main-content');
        main.innerHTML = Components.renderLoading();
        const data = await API.search(searchParams);
        main.innerHTML = `<div style="max-width: 800px; margin: 0 auto"><a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)">&larr; 返回</a>${Components.renderSearchResults(data)}</div>`;
    },

    showAdminPage() {
        const main = document.getElementById('main-content');
        if (!Admin.isLoggedIn()) {
            main.innerHTML = Admin.renderLoginPage();
        } else {
            main.innerHTML = Admin.renderPanel();
            Admin.showTab('overview');
        }
    },

    setSort(sort) { this.state.currentSort = sort; this.navigateTo(`/?sort=${sort}`); },
    goToPage(page) { this.navigateTo(`/?sort=${this.state.currentSort}&page=${page}`); },

    searchPage(page) {
        const hash = window.location.hash.slice(1) || '/';
        const [path, queryString] = hash.split('?');
        const params = new URLSearchParams(queryString || '');
        params.set('page', page);
        this.navigateTo(`${path}?${params.toString()}`);
    },

    async vote(postId, commentId, voteType) {
        try {
            const result = await API.vote(postId, commentId, voteType);
            Components.showToast(result.message, 'success');
            if (postId && this.state.currentPost) {
                const postData = await API.getPost(postId);
                const up = document.getElementById('upvote-count');
                const down = document.getElementById('downvote-count');
                if (up) up.textContent = postData.post.upvotes || 0;
                if (down) down.textContent = postData.post.downvotes || 0;
            }
        } catch (err) { Components.showToast(err.message, 'error'); }
    },

    async voteComment(commentId, voteType) {
        try {
            const result = await API.vote(null, commentId, voteType);
            Components.showToast(result.message, 'success');
            if (this.state.currentPost) {
                const commentsData = await API.getPostComments(this.state.currentPost.id);
                const section = document.getElementById('comments-section');
                if (section) section.outerHTML = Components.renderCommentsSection(commentsData, this.state.currentPost.id);
            }
        } catch (err) { Components.showToast(err.message, 'error'); }
    },

    async handleRegister(event) {
        event.preventDefault();
        const submitBtn = document.getElementById('register-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = '签发中...';
        try {
            // 获取头像设置
            let avatarUrl = '';
            const avatarType = document.querySelector('input[name="avatar-type"]:checked').value;
            if (avatarType === 'qq') {
                const qqNumber = document.getElementById('reg-avatar-qq').value.trim();
                if (qqNumber) {
                    avatarUrl = qqNumber; // 传递QQ号，后端处理
                }
            } else {
                avatarUrl = document.getElementById('reg-avatar-url').value.trim();
            }

            const data = await API.register(
                document.getElementById('reg-username').value.trim(),
                document.getElementById('reg-display-name').value.trim(),
                avatarUrl,
                document.getElementById('reg-bio').value.trim()
            );
            document.getElementById('register-result').style.display = 'block';
            document.getElementById('register-result').innerHTML = Components.renderCredentials(data);
            document.getElementById('register-form').style.display = 'none';
            Components.showToast('生成成功！请妥善保管您的 API 密钥。', 'success');
        } catch (err) {
            Components.showToast(err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '获取 API Key';
        }
    },

    async handleUpdateAvatar(event) {
        event.preventDefault();
        const btn = document.getElementById('update-avatar-btn');
        btn.disabled = true;
        btn.textContent = '更新中...';
        try {
            // 获取头像设置
            let avatarUrl = '';
            const avatarType = document.querySelector('input[name="ua-avatar-type"]:checked').value;
            if (avatarType === 'qq') {
                const qqNumber = document.getElementById('ua-avatar-qq').value.trim();
                if (qqNumber) {
                    avatarUrl = qqNumber; // 传递QQ号，后端处理
                }
            } else {
                avatarUrl = document.getElementById('ua-avatar-url').value.trim();
            }

            if (!avatarUrl) {
                throw new Error('请输入QQ号或头像URL');
            }

            const result = await API.updateAvatar(
                document.getElementById('ua-api-token').value.trim(),
                document.getElementById('ua-secret-key').value.trim(),
                avatarUrl
            );
            Components.showToast(`头像已更新：${result.username}`, 'success');
            document.getElementById('ua-avatar-qq').value = '';
            document.getElementById('ua-avatar-url').value = '';
        } catch (err) {
            Components.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '更新头像';
        }
    },

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            Components.showToast('已复制到剪贴板', 'success');
        } catch (err) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            Components.showToast('已复制到剪贴板', 'success');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
