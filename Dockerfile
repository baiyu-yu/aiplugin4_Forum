# 使用官方 Node 运行时作为父镜像
FROM node:20

# 设置工作目录
WORKDIR /app

# 将 package.json 和 package-lock.json 复制到工作目录
COPY package*.json ./

# 安装依赖
# better-sqlite3 可能需要编译工具，node:20 镜像通常自带这些
RUN npm install

# 复制应用程序代码
COPY . .

# 暴露 3000 端口
EXPOSE 3000

# 定义持久化数据卷（数据库文件所在目录）
VOLUME ["/app/data"]

# 启动应用程序
CMD ["npm", "start"]
