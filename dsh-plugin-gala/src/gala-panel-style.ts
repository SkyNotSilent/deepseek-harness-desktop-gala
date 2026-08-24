/**
 * Gala 面板样式 — 软萌手绘贴纸风 — PRD v4.0 §14.1
 *
 * 奶油底 + 贴纸卡 + 稀有度描边 + 弹性 hover。动画全部 ≤300ms（§14.3），
 * `prefers-reduced-motion` 与页内开关（body[data-no-motion]）双保险。
 * 面板是独立窗口，刻意采用单一奶油亮色视觉（不跟系统暗色走）。
 */

/** 稀有度颜色（与 gala-gallery-page 一脉相承的粉彩版） */
export const RARITY_COLORS: Record<string, string> = {
  common: '#a8b0bc',
  uncommon: '#5fd0a5',
  rare: '#6fa8ff',
  epic: '#c084fc',
  legendary: '#ffb703',
}

/** 面板整页 CSS */
export const PANEL_STYLE = `
  * { box-sizing: border-box; margin: 0; }
  :root {
    --cream: #fdf6ee;
    --paper: #ffffff;
    --ink: #3a3050;
    --ink-soft: #8d84a3;
    --blush: #ffd2e2;
    --mint: #c9efe2;
    --sun: #ffc857;
    --bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  html { color-scheme: light; }
  body {
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    background:
      radial-gradient(circle at 12% -4%, #ffeaf3 0%, transparent 34%),
      radial-gradient(circle at 96% 8%, #e2f6ef 0%, transparent 30%),
      var(--cream);
    color: var(--ink);
    min-height: 100vh;
    user-select: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 22px 28px 0;
  }
  header h1 {
    font-size: 22px;
    letter-spacing: 0.08em;
  }
  header h1 .paw { font-size: 18px; margin-right: 6px; }
  nav { display: flex; gap: 8px; margin-left: auto; }
  nav button {
    border: 2.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    padding: 8px 20px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 3px 0 var(--ink);
    transition: transform 150ms var(--bounce), box-shadow 150ms;
  }
  nav button:hover { transform: translateY(-2px); box-shadow: 0 5px 0 var(--ink); }
  nav button:active { transform: translateY(1px); box-shadow: 0 2px 0 var(--ink); }
  nav button[data-active] { background: var(--blush); }

  main { padding: 24px 28px 40px; }
  section[hidden] { display: none; }
  .empty { padding: 70px 0; text-align: center; color: var(--ink-soft); line-height: 2; }

  /* ── 图鉴 ── */
  #gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
    gap: 18px;
  }
  .gala-card {
    position: relative;
    background: var(--paper);
    border: 3px solid var(--ink);
    border-radius: 22px;
    padding: 16px 12px 14px;
    cursor: pointer;
    box-shadow: 0 5px 0 rgba(58, 48, 80, 0.9);
    transition: transform 200ms var(--bounce), box-shadow 200ms;
    animation: pop-in 240ms var(--bounce) backwards;
  }
  .gala-card::before {
    content: '';
    position: absolute;
    inset: 6px;
    border-radius: 16px;
    border: 2.5px dashed var(--rarity, #a8b0bc);
    opacity: 0.55;
    pointer-events: none;
  }
  .gala-card:hover { transform: translateY(-5px) rotate(-1.2deg); box-shadow: 0 9px 0 rgba(58, 48, 80, 0.85); }
  .gala-card img { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; }
  .gala-card .name { text-align: center; font-size: 16px; font-weight: 800; margin-top: 4px; }
  .gala-card .rarity {
    display: block;
    width: fit-content;
    margin: 6px auto 0;
    padding: 2px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    background: var(--rarity, #a8b0bc);
  }
  .gala-card .star {
    position: absolute;
    top: -10px;
    right: -6px;
    font-size: 26px;
    color: #ffb703;
    text-shadow: 0 2px 0 var(--ink);
    transform: rotate(12deg);
  }
  .gala-card .default-chip {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 1;
    padding: 3px 9px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--mint);
    color: var(--ink);
    font-size: 11px;
    font-weight: 900;
    box-shadow: 0 2px 0 var(--ink);
  }
  .gala-card[data-rarity="legendary"] { animation: pop-in 240ms var(--bounce) backwards, glow 2.6s ease-in-out infinite; }

  /* ── 详情 ── */
  #detail {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(58, 48, 80, 0.35);
    backdrop-filter: blur(3px);
  }
  #detail[hidden] { display: none; }
  #detail .sheet {
    width: min(520px, calc(100vw - 60px));
    background: var(--paper);
    border: 3.5px solid var(--ink);
    border-radius: 26px;
    box-shadow: 0 8px 0 rgba(58, 48, 80, 0.9);
    padding: 26px 28px;
    animation: flip-in 280ms var(--bounce);
    transform-style: preserve-3d;
  }
  #detail img { width: 190px; height: 190px; object-fit: contain; display: block; margin: 0 auto; }
  #detail h2 { text-align: center; font-size: 24px; margin-top: 4px; }
  #detail .meta { display: flex; justify-content: center; gap: 8px; margin: 10px 0 12px; }
  #detail .chip {
    padding: 3px 14px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    font-size: 12px;
    font-weight: 700;
    background: var(--chip, var(--blush));
  }
  #detail .desc { line-height: 1.9; font-size: 14.5px; }
  #detail .persona { margin-top: 12px; font-size: 13.5px; line-height: 1.8; display: flex; flex-direction: column; gap: 6px; }
  #detail .persona[hidden] { display: none; }
  #detail .persona .chip { align-self: flex-start; --chip: var(--mint, #d6f5e7); }
  #detail .quote { margin-top: 10px; color: var(--ink-soft); font-size: 13px; }
  #detail .recipes { margin-top: 12px; font-size: 13px; color: var(--ink-soft); }
  #detail .actions { display: flex; justify-content: center; gap: 12px; margin-top: 18px; }
  .btn {
    border: 2.5px solid var(--ink);
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    padding: 9px 24px;
    cursor: pointer;
    box-shadow: 0 3px 0 var(--ink);
    transition: transform 150ms var(--bounce), box-shadow 150ms, background 150ms;
  }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 0 var(--ink); }
  .btn:active { transform: translateY(1px); box-shadow: 0 2px 0 var(--ink); }
  .btn.primary { background: var(--blush); }
  .btn:disabled { cursor: not-allowed; opacity: 0.48; transform: none; box-shadow: 0 3px 0 var(--ink); }

  /* ── 换肤 ── */
  .skin-section-heading { margin: 2px 0 16px; }
  .skin-section-heading > span { color: #c95b87; font-size: 11px; font-weight: 800; letter-spacing: .16em; }
  .skin-section-heading h2 { margin-top: 4px; font-size: 22px; }
  .skin-section-heading p { margin-top: 5px; color: var(--ink-soft); font-size: 13px; }
  .skin-section-heading.classic-heading { margin-top: 34px; }
  #skins-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 18px;
  }
  .skin-card {
    position: relative;
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    min-height: 190px;
    overflow: hidden;
    background: var(--paper);
    border: 3px solid var(--ink);
    border-radius: 22px;
    padding: 18px;
    box-shadow: 0 5px 0 rgba(58, 48, 80, 0.9);
    animation: pop-in 240ms var(--bounce) backwards;
  }
  .skin-card::after {
    content: '';
    position: absolute;
    inset: auto -24px -28px auto;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: var(--blush);
    opacity: 0.28;
    pointer-events: none;
  }
  .skin-card .skin-copy { min-width: 0; align-self: center; }
  .skin-card .skin-art {
    align-self: end;
    width: 120px;
    height: 152px;
    margin: 12px 2px -18px -14px;
    object-fit: contain;
    filter: drop-shadow(0 5px 0 rgba(58, 48, 80, 0.12));
  }
  .skin-card .skin-orb {
    align-self: center;
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border: 3px solid var(--ink);
    border-radius: 31% 69% 54% 46% / 55% 35% 65% 45%;
    background: linear-gradient(145deg, var(--blush), var(--mint));
    box-shadow: 0 5px 0 var(--ink);
    transform: rotate(-7deg);
    font-size: 30px;
  }
  .skin-card h3 { font-size: 17px; }
  .skin-card .desc { margin: 6px 0 12px; font-size: 13px; color: var(--ink-soft); line-height: 1.7; }
  .skin-card .swatches { display: flex; gap: 8px; margin-bottom: 14px; }
  .skin-card .swatch {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    border: 2.5px solid var(--ink);
  }
  .skin-card .actions { display: flex; gap: 10px; }
  .skin-card[data-active] { outline: 3.5px solid #ffb703; outline-offset: 4px; }
  .skin-card[data-active] h3::after { content: ' ✓ 使用中'; color: #d69400; font-size: 13px; }
  #classic-skins { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .classic-skin {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 2.5px solid var(--ink);
    border-radius: 18px;
    background: color-mix(in srgb, var(--paper) 92%, var(--mint));
    box-shadow: 0 4px 0 rgba(58, 48, 80, .8);
  }
  .classic-skin h3 { font-size: 15px; }
  .classic-skin p { margin-top: 4px; color: var(--ink-soft); font-size: 12px; line-height: 1.5; }
  .classic-skin .swatches { display: flex; gap: 6px; }
  .classic-skin .swatch { width: 28px; height: 28px; border: 2px solid var(--ink); border-radius: 9px; }
  .classic-skin .actions { display: flex; gap: 8px; }
  .classic-skin .btn { padding: 7px 16px; font-size: 12px; }
  .classic-skin[data-active] { outline: 3.5px solid #ffb703; outline-offset: 3px; }
  .classic-skin[data-active] h3::after { content: ' ✓ 使用中'; color: #d69400; font-size: 12px; }
  @media (max-width: 900px) { #classic-skins { grid-template-columns: 1fr; } }

  /* ── 合成工坊 ── */
  .atelier-hero {
    position: relative;
    min-height: 210px;
    margin-bottom: 20px;
    overflow: hidden;
    border: 3px solid var(--ink);
    border-radius: 26px;
    background: #f8dcc5;
    box-shadow: 0 6px 0 rgba(58, 48, 80, 0.9);
  }
  .atelier-hero img { width: 100%; height: 240px; display: block; object-fit: cover; }
  .atelier-hero::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(58, 48, 80, 0.88) 0%, rgba(58, 48, 80, 0.66) 36%, transparent 68%);
  }
  .atelier-copy {
    position: absolute;
    z-index: 1;
    left: 28px;
    top: 50%;
    width: min(390px, 48%);
    color: #fff;
    transform: translateY(-50%);
    text-shadow: 0 2px 12px rgba(45, 31, 54, 0.45);
  }
  .atelier-copy .eyebrow { font-size: 11px; letter-spacing: 0.2em; font-weight: 900; color: #ffe3a1; }
  .atelier-copy h2 { margin-top: 7px; font-size: 27px; letter-spacing: 0.04em; }
  .atelier-copy p { margin-top: 8px; line-height: 1.65; font-size: 13px; }
  #compose-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 18px;
  }
  .recipe-card {
    position: relative;
    padding: 20px;
    border: 3px solid var(--ink);
    border-radius: 22px;
    background:
      linear-gradient(135deg, rgba(255, 210, 226, 0.38), transparent 45%),
      var(--paper);
    box-shadow: 0 5px 0 rgba(58, 48, 80, 0.9);
    animation: pop-in 240ms var(--bounce) backwards;
    transition: transform 180ms var(--bounce), box-shadow 180ms, outline-color 180ms;
  }
  .recipe-card[data-ready]::before {
    content: 'READY';
    position: absolute;
    top: 13px;
    right: 16px;
    padding: 3px 9px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--mint);
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.14em;
    transform: rotate(3deg);
  }
  .recipe-card[data-highlight] {
    transform: translateY(-6px) rotate(-0.5deg);
    box-shadow: 0 10px 0 rgba(58, 48, 80, 0.9), 0 0 0 7px rgba(255, 200, 87, 0.5);
  }
  .recipe-tier { color: #ee9e00; letter-spacing: 0.12em; font-size: 14px; text-shadow: 0 1px 0 var(--ink); }
  .recipe-card h3 { margin-top: 8px; font-size: 19px; }
  .recipe-card > .desc { margin-top: 7px; min-height: 44px; color: var(--ink-soft); font-size: 13px; line-height: 1.7; }
  .ingredients { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .ingredient {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
  }
  .ingredient.owned { background: var(--mint); }
  .ingredient.missing { color: #89525f; background: #ffe5eb; border-style: dashed; }
  .recipe-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; }
  .recipe-state { color: var(--ink-soft); font-size: 12px; font-weight: 800; }
  .compose-warning { margin-top: 12px; color: #9a7080; font-size: 11px; line-height: 1.5; }
  .compose-error {
    padding: 24px;
    border: 3px dashed #d86f88;
    border-radius: 20px;
    background: #fff0f4;
    color: #74404f;
  }
  .compose-error p { margin-top: 8px; font-size: 12px; line-height: 1.6; user-select: text; }

  #relaunch-overlay {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(49, 38, 67, 0.74);
    backdrop-filter: blur(9px);
  }
  #relaunch-overlay[hidden] { display: none; }
  .relaunch-card {
    width: min(480px, calc(100vw - 48px));
    padding: 42px 34px;
    text-align: center;
    border: 3px solid var(--ink);
    border-radius: 28px;
    background: var(--paper);
    box-shadow: 0 9px 0 var(--ink);
    animation: flip-in 280ms var(--bounce);
  }
  .relaunch-spark { display: block; margin-bottom: 12px; font-size: 42px; animation: sparkle 1.2s ease-in-out infinite; }
  .relaunch-card h2 { font-size: 22px; }
  .relaunch-card p { margin-top: 10px; color: var(--ink-soft); font-size: 13px; }

  /* ── 市场 ── */
  #market .hint { color: var(--ink-soft); line-height: 2; margin-bottom: 18px; }
  #market ul { list-style: none; display: grid; gap: 10px; }
  #market li {
    background: var(--paper);
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    padding: 12px 18px;
    display: flex;
    gap: 12px;
    align-items: center;
    box-shadow: 0 3px 0 rgba(58, 48, 80, 0.85);
  }

  /* ── 页脚 / toast ── */
  footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    padding: 10px 20px;
    pointer-events: none;
  }
  footer label { pointer-events: auto; font-size: 12px; color: var(--ink-soft); cursor: pointer; }
  #toast {
    position: fixed;
    left: 50%;
    bottom: 46px;
    transform: translateX(-50%);
    background: var(--ink);
    color: #fff;
    padding: 10px 24px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    box-shadow: 0 4px 14px rgba(58, 48, 80, 0.4);
    opacity: 0;
    transition: opacity 200ms;
    pointer-events: none;
  }
  #toast[data-show] { opacity: 1; }

  @keyframes pop-in {
    from { opacity: 0; transform: translateY(14px) scale(0.92); }
    to { opacity: 1; transform: none; }
  }
  @keyframes flip-in {
    from { opacity: 0; transform: rotateY(70deg) scale(0.9); }
    to { opacity: 1; transform: none; }
  }
  @keyframes glow {
    0%, 100% { box-shadow: 0 5px 0 rgba(58, 48, 80, 0.9), 0 0 0 rgba(255, 183, 3, 0); }
    50% { box-shadow: 0 5px 0 rgba(58, 48, 80, 0.9), 0 0 26px rgba(255, 183, 3, 0.55); }
  }
  @keyframes sparkle { 50% { transform: scale(1.15) rotate(8deg); } }
  @media (max-width: 720px) {
    header { align-items: flex-start; flex-direction: column; }
    nav { width: 100%; margin-left: 0; overflow-x: auto; padding-bottom: 4px; }
    nav button { flex: 0 0 auto; padding-inline: 16px; }
    .atelier-copy { left: 20px; width: 66%; }
    .atelier-copy h2 { font-size: 22px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
  body[data-no-motion] *, body[data-no-motion] *::before, body[data-no-motion] *::after {
    animation: none !important;
    transition: none !important;
  }
`
