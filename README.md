# 归流

一个脱离平台默认算法的视频主页。电脑端用 Chrome/Edge 插件从你已经打开的 YouTube/B站页面采集可见视频卡片；手机和电脑端打开 PWA 后看到同一个视频网格，并通过每一次“感兴趣 / 不感兴趣”重新排序。

## 现在的体验

- 首页是 YouTube 式视频网格，不再是空白收件箱。
- 分类：全部、订阅、平台推荐、稍后看、已隐藏。
- 内容来源：桌面插件采集 YouTube/B站订阅页、首页推荐页、频道/UP 主页当前可见视频。
- 每张卡片都有：封面、标题、频道、平台、来源、时长、播放量/发布时间、推荐原因、反馈按钮。
- 点“不感兴趣”会选择原因：低价值、太长、情绪消耗、不喜欢主题、不喜欢频道、标题党、重复内容。
- 手机端只负责观看和反馈；电脑插件负责采集。
- 保留 PWA 安装、每日使用时长、20/45/75 分钟温和提醒。

## GitHub Pages 部署

把整个 `guiliu` 文件夹内容放进 GitHub 仓库根目录，开启 Settings → Pages → Deploy from branch。iPhone 用 Safari 打开 GitHub Pages 地址，再添加到主屏幕。

## Supabase 同步与采集

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase-video.sql`。
3. 在 `config.js` 填入：

```js
window.GUILIU_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 anon/publishable key",
  aiAccessCode: "",
};
```

4. 重新部署 PWA。
5. 在 Supabase Authentication → URL Configuration 中，把 Site URL 和 Redirect URLs 设置为你的 PWA 地址。
6. 打开归流，在“采集与同步”里用邮箱登录。
7. 登录后点击“生成插件采集码”。这个码给 Chrome/Edge 插件使用。

## 安装 Chrome/Edge 插件

1. 打开 Chrome/Edge 扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择 `guiliu/extension` 文件夹。
5. 打开插件弹窗，填入 Supabase URL、anon key、归流采集码并保存。

## 采集视频

1. 在电脑浏览器打开 YouTube 订阅页、YouTube 首页、B站首页、B站动态/关注页或 UP 主空间。
2. 先滚动一下，让视频卡片加载出来。
3. 点浏览器工具栏里的“归流采集器”。
4. 点“采集当前页面”。
5. 回到手机或电脑上的归流，点同步/刷新，就能看到新视频。

插件只读取页面上已经可见的视频卡片，不读取 cookie、私信、评论或账号资料。

## 文件结构

```text
guiliu/
  index.html
  styles.css
  app.js
  config.js
  manifest.webmanifest
  sw.js
  supabase-video.sql
  extension/
    manifest.json
    popup.html
    popup.css
    popup.js
    content.js
```

## 注意

- YouTube 没有公开“我的首页推荐”API；归流通过插件采集你页面上已经看到的推荐卡片。
- B站第一版同样走可见页面采集，不使用后台 cookie 抓取。
- GitHub Pages 可以部署前端和插件文件，但插件写入同步需要 Supabase。
- 如果手机没有立刻更新新界面，关闭主屏幕 PWA 后重新打开，或在 Safari 里访问一次最新地址。
