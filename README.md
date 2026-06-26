# 归流

一个本地优先的个人内容主页。它接收你主动分享或粘贴进来的视频、文章、笔记和帖子，用你的评价沉淀 taste，并用温和提醒避免再次滑进平台信息流。

## 运行

直接打开 `index.html` 即可试用。要测试 PWA、分享入口和离线缓存，建议用任意静态服务器或部署到 Netlify。

## 已实现

- 推荐主页、待评价、Taste 画像三段界面
- YouTube/B站视频内嵌播放，其他平台干净跳转
- 手机分享入口：PWA `share_target`
- 粘贴链接收集内容
- 感兴趣、不感兴趣、稍后看
- 每日总使用时长、推荐页时长、播放页时长
- 连续 20 分钟、每日 45 分钟、每日 75 分钟温和提醒
- 本地 JSON 导入/导出
- 可选 Supabase 邮箱魔法链接登录与自动同步
- 可选 OpenAI 分析函数
- 1024、512、192、Apple touch icon 图标资产

## Supabase 同步

在 `config.js` 填入：

```js
window.GUILIU_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  aiAccessCode: "",
};
```

在 Supabase SQL editor 执行：

```sql
create table if not exists public.guiliu_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.guiliu_states enable row level security;

create policy "Users can read own guiliu state"
on public.guiliu_states
for select
using (auth.uid() = user_id);

create policy "Users can insert own guiliu state"
on public.guiliu_states
for insert
with check (auth.uid() = user_id);

create policy "Users can update own guiliu state"
on public.guiliu_states
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

然后在 app 的 Taste 画像页输入邮箱，点击发送登录链接。iPhone 和 PC 使用同一个邮箱登录后，会同步内容、评价、画像和使用时长。使用时长按设备分桶合并，避免重复叠加。

## AI 分析

部署到 Netlify 后，在环境变量中配置：

```text
OPENAI_API_KEY=你的 key
APP_ACCESS_CODE=自定义访问码
OPENAI_MODEL=gpt-5.5
```

`APP_ACCESS_CODE` 可在 `config.js` 或 app 设置里填入。未配置 OpenAI 时，前端会使用本地规则整理，不影响基础使用。

## 文件结构

```text
guiliu/
  index.html
  styles.css
  app.js
  config.js
  manifest.webmanifest
  sw.js
  icon.svg
  icon-1024.png
  icon-512.png
  icon-192.png
  apple-touch-icon.png
  netlify/functions/analyze.js
```

## 备注

小红书、微博、豆瓣第一版以链接卡片和手写摘要为主，不绕过平台限制抓取私有内容。YouTube 使用官方 iframe 形式，B站使用外链播放器并保留原链接兜底。
