# Coin Slot Arcade

*[English](README.md) · 中文*

**浏览器里的原创游戏厅：6 款完整的 3D 游戏，加 5 台随开随玩的 2D 小游戏机。** 不用安装，不用注册：打开大厅，走进一条霓虹街机长廊，挑一台机器开玩。所有模型、贴图、关卡和音效都由代码实时生成，整个游戏厅就是一个装着 HTML 和 JavaScript 的文件夹。

| | | |
|:-:|:-:|:-:|
| ![风驰](games/windrift/poster.webp) **风驰 Windrift**<br>卡丁车竞速 | ![Cargo Deck](games/cargo-deck/poster.webp) **Cargo Deck**<br>团队枪战 | ![双门](games/twin-gate/poster.webp) **双门 Twin Gate**<br>传送门解谜 |
| ![折阶](games/folded-steps/poster.webp) **折阶 Folded Steps**<br>视错觉解谜 | ![Pelican Pedal](games/pelican-pedal/poster.webp) **Pelican Pedal**<br>海岸骑行 | ![Cloudspire](games/cloudspire/poster.webp) **Cloudspire**<br>云端跑酷 |

## 30 秒开玩

**在线玩**：**https://mira190.github.io/coin-slot/**，无需安装。每个游戏也有自己的地址，例如 `…/coin-slot/games/windrift/`。

**本地运行**：

游戏用的是 ES 模块，需要通过 HTTP 访问，直接双击打开文件不行。随便起一个静态服务器就可以：

```bash
python3 -m http.server 8000      # 或者：npx serve .
```

然后打开 **http://localhost:8000**。每个游戏也能单独运行，地址是 `games/<id>/`，可以直接收藏或分享某一个游戏。

**想放到网上**：把整个文件夹原样上传到任意静态托管（GitHub Pages、Cloudflare Pages、Netlify、S3），不需要构建。

**运行环境**：
- 较新的桌面版 Chrome、Edge、Firefox 或 Safari，需要支持 WebGL 2。
- 大部分游戏在手机上可以用触屏玩；Cargo Deck 和 Twin Gate 是为键盘加鼠标设计的。
- 联网只用于两件事：从 jsDelivr CDN 加载 three.js，从 Google Fonts 加载字体。

## 游戏介绍

### 主舞台：3D

| 游戏 | 内容 | 推荐玩法 |
|---|---|---|
| **风驰 Windrift** | 街机卡丁车。4 条赛道（城市夜景、风车海湾、冰川、沙漠金字塔），8 名车手；竞速、道具、计时三种模式；一整套漂移与喷射技巧。 | 过弯时按住 **Shift** 漂移，喷射灯亮起的瞬间点一下 **↑**。 |
| **Cargo Deck** | 停泊在港口的集装箱货轮上的 5v5 团队枪战，对手是 bot。有团队死斗和歼灭两种模式，7 种武器、3 种手雷。 | 用栓动狙击守住舰桥窗口，或者从侧翼管道突袭。 |
| **双门 Twin Gate** | 第一人称传送门解谜。两道相连的门，15 个测试间加一段屋顶逃脱，还有一位全程点评你的评估员。 | 从一道门掉下去，以同样的速度从另一道门飞出来。 |
| **折阶 Folded Steps** | 视错觉解谜。12 个关卡，路只在你看过去的那个角度才连得上。另有带求解器的关卡编辑器。 | 转动机关，直到两块相隔很远的平台在画面上对齐，然后走过去。 |
| **Pelican Pedal** | 一只大白鹈鹕骑着自行车，环绕雪山下的海岸小岛，从日出一直骑到银河升起。一半是骑行游戏，一半是镜头作品。 | 按 **P** 进入拍照模式，把时间拖到日落。 |
| **Cloudspire** | 在云海之上的断桥间无尽奔跑，身后紧追着一只风暴精灵。 | 攒够 100 个碎片，换一个带护盾的开局。 |

### 小游戏机：2D

| 游戏 | 类型 | 操作 |
|---|---|---|
| **Neon Circuit** | 夜间车流竞速 | ← → 转向，↓ 刹车，Space 氮气 |
| **Coil** | 贪吃蛇 | 方向键（可预存两次转向） |
| **Stackfall** | 方块消除 | ← → 移动，↑ 旋转，↓ 软降，Space 硬降 |
| **Brickstorm** | 打砖块 | 鼠标或 ← → 移动挡板，Space 发球 |
| **Lantern Drift** | 单键飞行 | Space、↑ 或点击屏幕上升 |

5 台小游戏机都支持手机滑动和点击，按 **P** 暂停，并会记住你的最高分。

<details>
<summary><b>3D 游戏完整操作</b></summary>

**风驰 Windrift**
- ↑ 加速（喷射灯亮时点一下触发小喷）· ↓ 刹车 · ← → 转向
- **Shift** 漂移 · **Ctrl** 或 **Space** 氮气 / 道具 1 · **Z / X** 使用道具
- **R** 回到赛道 · **C** 切换视角 · **Esc** 暂停 · **M** 静音
- 支持手柄和触屏。用 WASD 时请用 Space 放氮气，因为浏览器不允许网页拦截 Ctrl+W（关闭标签页）。

**Cargo Deck**
- **WASD** 移动 · 鼠标转视角（点击画面锁定鼠标）· 左键开火 · 右键瞄准 / 开镜
- **Shift** 静步 · **C/Ctrl** 蹲下 · **Space** 跳 · **R** 换弹
- **1–4** 主武器 / 手枪 / 刀 / 手雷 · **G** 切换手雷 · **Q** 上一把武器 · **F** 检视武器
- **Tab** 记分板 · **Esc** 设置

**双门 Twin Gate**
- 鼠标转视角 · 左键或 **Q** 开第一道门（拿着方块时是扔出）· 右键开第二道门（拿着方块时是放下）
- **WASD** 移动 · **Space** 跳 · **E** 拿起 / 使用
- **R** 重开本关 · **Esc** 暂停 · **M** 静音

**折阶 Folded Steps**
- 点击格子走过去 · 拖动红色把手转动或推动机关，键盘可用 **Tab** 选中、**Q/E** 操作
- **Z** 撤销 · **R** 重来 · **H** 提示 · **Esc** 地图

**Pelican Pedal**
- **W/↑** 踩踏板 · **S/↓** 刹车 · **A D / ← →** 转向
- **F** 张大喉囊 · **Space** 跳 · **Shift** 展翅翘头 · **B** 车铃
- **C** 或 **1–5** 切换镜头 · **P** 拍照模式 · **H** 隐藏界面 · **Esc** 设置

**Cloudspire**
- ← → 换道，在路口转向 · ↑ 或 **Space** 跳 · ↓ 滑铲
- 触屏上用滑动操作

</details>

## 项目结构

```
index.html             大厅：一座实时渲染的 3D 街机长廊，列出所有游戏
arcade/                公共部分：游戏目录、大厅、2D 游戏机引擎、样式
games/<id>/            每个游戏一个文件夹，都能单独运行
  index.html + src/      3D 游戏：原生 ES 模块，通过 import map 加载 three.js
  game.js                2D 游戏：在公共游戏机引擎里运行的单个模块
  card.js                3D 游戏的大厅卡片（标题、动态预览、最高分）
  poster.webp            大厅海报（部分游戏另有 preview.webm 短预览）
```

- **不用构建，也不用安装依赖。** 全部是手写的 JavaScript；3D 游戏使用从 CDN 加载的 [three.js](https://threejs.org) r186。
- **生成而不是下载。** 地形、建筑、角色、贴图、音效和音乐都在运行时生成，没有图片或音频素材。海报是真实截图，只在大厅里用到。
- **默认保护隐私。** 没有统计分析，没有账号，也没有服务器。最高分和设置只保存在你自己浏览器的本地存储里。
- **加一个新游戏只需要一个文件夹加一行代码。** 把游戏放进 `games/<id>/`，再在 `arcade/registry.js` 里加上 `{ id: '<id>' }`。3D 游戏提供 `index.html` 和 `card.js`；2D 游戏提供一个给公共游戏机引擎用的 `game.js`。

## 关于这些游戏

这里的每个标题、角色、关卡、地图、模型、贴图和声音都是为本项目原创的。游戏借鉴的是大家熟悉的玩法类型（卡丁车竞速、团队射击、传送门与视错觉解谜、无尽跑酷和经典街机），但没有使用任何现有游戏的名称、美术、关卡或其他素材。

## 许可证

[MIT](LICENSE) © 2026 Mira Wu。你可以自由地游玩、学习、修改和复用这些代码，包括用在自己的项目里，只需保留许可证声明。three.js（通过 CDN 加载）由其作者以 MIT 许可证发布；字体由 Google Fonts 按各自的开源许可提供。
