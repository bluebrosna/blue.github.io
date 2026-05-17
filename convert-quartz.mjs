import { JSDOM } from "jsdom";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import { toHtml } from "hast-util-to-html";

// --- Converter from naver_blog_hacked (inlined) ---
// We'll import the TS converter logic rewritten for Node

const T = {
  p: "font-size:15px;line-height:1.8;color:#333;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h1: "font-size:26px;font-weight:700;color:#333;line-height:1.5;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h2: "font-size:21px;font-weight:700;color:#333;line-height:1.5;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h3: "font-size:18px;font-weight:700;color:#333;line-height:1.5;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h4: "font-size:17px;font-weight:700;color:#333;line-height:1.6;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h5: "font-size:15px;font-weight:700;color:#333;line-height:1.6;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  h6: "font-size:13px;font-weight:700;color:#777;line-height:1.6;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  strong: "font-weight:700;",
  em: "font-style:italic;",
  del: "text-decoration:line-through;color:#777;",
  a: "color:#608cba;text-decoration:underline;",
  img: "max-width:100%;height:auto;display:block;margin:0 auto;",
  codeInline: "background:#f4f5f5;color:#333;padding:2px 6px;border-radius:2px;font-family:'Source Code Pro',Consolas,Monaco,monospace;font-size:13px;",
  codeBlockWrap: "background:#f4f5f5;padding:12px 17px;margin:0;font-family:'Source Code Pro',Consolas,Monaco,monospace;font-size:13px;line-height:1.85;color:#000;overflow-x:auto;",
  codeLine: "white-space:pre;",
  blockquoteWrap: "border-left:6px solid #515151;padding:10px 20px;margin:0;",
  blockquoteP: "font-size:19px;line-height:1.8;color:#333;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  hr: "border:none;height:1px;background:#ddd;margin:18px 0;",
  imgPlaceholder: "border:1px dashed #c8c8c8;background:#fafafa;padding:14px;text-align:center;color:#888;font-size:13px;font-family:sans-serif;margin:0;",
  tableWrap: "overflow-x:auto;",
  table: "border-collapse:separate;width:100%;font-size:15px;border:solid #d2d2d2;border-width:1px 0 0 1px;",
  thead: "",
  tbody: "",
  tr: "",
  th: "border:solid #d2d2d2;border-width:0 1px 1px 0;padding:10px;background:#f7f7f7;font-weight:700;text-align:left;color:#333;",
  td: "border:solid #d2d2d2;border-width:0 1px 1px 0;padding:10px;color:#333;",
  listItem: "font-size:15px;line-height:1.8;color:#333;margin:0;font-family:'Nanum Gothic','나눔고딕',sans-serif;",
  bullet1: "•",
  bullet2: "◦",
  bullet3: "▪",
};

// 빈 단락은 네이버 SmartEditor에서 얇은 회색 선처럼 렌더링되는 경우가 있어 제거.
// 단락 간 간격은 네이버 에디터 자체 줄간격에 맡긴다.
const SPACER = ``;

// 이미지 수집기 — 본문에서는 짧은 마커로 표시하고, 글 끝에 일괄 정리한다.
// 옵션 1 (위치별 자동 업로드)은 후속 작업으로 미뤄둠.
const imageCollector = { items: [], lastSection: null };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NBSP = "&nbsp;";
const indent = (depth) => NBSP.repeat(Math.max(0, depth) * 4);

function renderInlineNode(node) {
  if (node.nodeType === 3) return esc(node.textContent || "");
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  const kids = Array.from(node.childNodes).map(renderInlineNode).join("");

  switch (tag) {
    case "strong": case "b": return `<strong style="${T.strong}">${kids}</strong>`;
    case "em": case "i": return `<em style="${T.em}">${kids}</em>`;
    case "del": case "s": case "strike": return `<del style="${T.del}">${kids}</del>`;
    case "code": return `<code style="${T.codeInline}">${kids}</code>`;
    case "a": {
      const href = node.getAttribute("href") || "#";
      return `<a href="${esc(href)}" style="${T.a}">${kids}</a>`;
    }
    case "br": return "<br/>";
    case "img": {
      // 네이버는 외부 이미지를 차단. 짧은 마커로만 표시, 원본은 끝에 정리.
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "이미지";
      imageCollector.items.push({ src, alt, section: imageCollector.lastSection });
      return `[📷${imageCollector.items.length}]`;
    }
    case "span": case "font": return kids;
    case "u": return `<u>${kids}</u>`;
    default: return kids;
  }
}

function flattenList(ul, depth, ordered, parts) {
  const items = Array.from(ul.children).filter(c => c.tagName.toLowerCase() === "li");
  let n = 1;
  for (const li of items) {
    const nestedLists = [];
    const inlineKids = [];
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === 1 && /^(ul|ol)$/i.test(child.tagName)) {
        nestedLists.push(child);
      } else {
        inlineKids.push(child);
      }
    }
    const text = inlineKids.map(renderInlineNode).join("").trim();
    const marker = ordered ? `${n}.` : depth === 0 ? T.bullet1 : depth === 1 ? T.bullet2 : T.bullet3;
    if (text) parts.push(`<p style="${T.listItem}">${indent(depth)}${marker} ${text}</p>`);
    for (const nl of nestedLists) {
      flattenList(nl, depth + 1, nl.tagName.toLowerCase() === "ol", parts);
    }
    n++;
  }
}

function renderBlockNode(node, out) {
  if (node.nodeType === 3) {
    const txt = (node.textContent || "").trim();
    if (txt) out.push(`<p style="${T.p}">${esc(txt)}</p>`);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  const pushSpacer = () => { if (out.length > 0) out.push(SPACER); };

  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      pushSpacer();
      const level = parseInt(tag[1], 10);
      const style = [T.h1, T.h2, T.h3, T.h4, T.h5, T.h6][level - 1];
      const inner = Array.from(node.childNodes).map(renderInlineNode).join("");
      // 이미지 위치 추적용 — 가장 최근 헤딩 텍스트 기억
      imageCollector.lastSection = (node.textContent || "").trim().slice(0, 60);
      out.push(`<h${level} style="${style}">${inner}</h${level}>`);
      return;
    }
    case "p": {
      pushSpacer();
      const inner = Array.from(node.childNodes).map(renderInlineNode).join("");
      if (inner.trim()) out.push(`<p style="${T.p}"><span>${inner}</span></p>`);
      return;
    }
    case "blockquote": {
      pushSpacer();
      const childParts = [];
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 3) {
          const t = (c.textContent || "").trim();
          if (t) childParts.push(`<p style="${T.blockquoteP}">${esc(t)}</p>`);
        } else if (c.nodeType === 1) {
          if (/^p$/i.test(c.tagName)) {
            const inner = Array.from(c.childNodes).map(renderInlineNode).join("");
            childParts.push(`<p style="${T.blockquoteP}">${inner}</p>`);
          } else {
            const inner = renderInlineNode(c);
            if (inner.trim()) childParts.push(`<p style="${T.blockquoteP}">${inner}</p>`);
          }
        }
      }
      out.push(`<div style="${T.blockquoteWrap}">${childParts.join(SPACER)}</div>`);
      return;
    }
    case "pre": {
      pushSpacer();
      const codeEl = node.querySelector("code") || node;
      const text = codeEl.textContent || "";
      const lines = text.replace(/\n$/, "").split("\n").map(l => `<div style="${T.codeLine}">${esc(l) || "&nbsp;"}</div>`).join("");
      out.push(`<div style="${T.codeBlockWrap}">${lines}</div>`);
      return;
    }
    case "hr": {
      pushSpacer();
      out.push(`<hr style="${T.hr}" />`);
      return;
    }
    case "ul": case "ol": {
      pushSpacer();
      const parts = [];
      flattenList(node, 0, tag === "ol", parts);
      out.push(parts.join(""));
      return;
    }
    case "table": {
      pushSpacer();
      const rows = [];
      const theadEl = node.querySelector("thead");
      const tbodyEl = node.querySelector("tbody") || node;
      if (theadEl) {
        const trs = Array.from(theadEl.querySelectorAll("tr"));
        const headCells = trs.flatMap(tr => Array.from(tr.children))
          .map(c => `<th style="${T.th}">${Array.from(c.childNodes).map(renderInlineNode).join("")}</th>`);
        rows.push(`<thead><tr>${headCells.join("")}</tr></thead>`);
      }
      const bodyTrs = Array.from(tbodyEl.querySelectorAll(":scope > tr"));
      const allTrs = bodyTrs.length ? bodyTrs : Array.from(node.querySelectorAll("tr")).filter(tr => !theadEl || !theadEl.contains(tr));
      const bodyRows = allTrs.map(tr => {
        const cells = Array.from(tr.children).map(c => {
          const tagC = c.tagName.toLowerCase();
          const style = tagC === "th" ? T.th : T.td;
          return `<${tagC} style="${style}">${Array.from(c.childNodes).map(renderInlineNode).join("")}</${tagC}>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      });
      rows.push(`<tbody>${bodyRows.join("")}</tbody>`);
      out.push(`<div style="${T.tableWrap}"><table style="${T.table}">${rows.join("")}</table></div>`);
      return;
    }
    case "img": {
      // 네이버는 외부 이미지 차단. 짧은 마커만 본문에 남기고 원본은 끝에 정리.
      pushSpacer();
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "이미지";
      imageCollector.items.push({ src, alt, section: imageCollector.lastSection });
      out.push(`<p style="${T.p};color:#999;">[📷${imageCollector.items.length}]</p>`);
      return;
    }
    case "figure": {
      const img = node.querySelector("img");
      if (img) renderBlockNode(img, out);
      const caption = node.querySelector("figcaption");
      if (caption) {
        pushSpacer();
        out.push(`<p style="${T.p};text-align:center;color:#777;font-size:13px;">${Array.from(caption.childNodes).map(renderInlineNode).join("")}</p>`);
      }
      return;
    }
    case "div": case "section": case "article": case "main":
    case "header": case "footer": case "aside": case "nav": {
      for (const c of Array.from(node.childNodes)) renderBlockNode(c, out);
      return;
    }
    case "br": return;
    case "script": case "style": case "link": case "iframe":
    case "embed": case "object": case "noscript": case "meta": return;
    default: {
      const inner = Array.from(node.childNodes).map(renderInlineNode).join("");
      if (inner.trim()) {
        pushSpacer();
        out.push(`<p style="${T.p}"><span>${inner}</span></p>`);
      }
    }
  }
}

// --- Main ---
const inputFile = process.argv[2];

function resolveInputPath(file) {
  if (!file) return null;
  const direct = resolve(file);
  if (existsSync(direct)) return direct;
  const contentPath = resolve("content", file);
  if (existsSync(contentPath)) return contentPath;
  return direct;
}

async function markdownFileToArticle(file) {
  const source = readFileSync(file, "utf-8");
  const parsed = matter(source);
  const hast = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .run(await unified().use(remarkParse).parse(parsed.content));
  const html = toHtml(hast, { allowDangerousHtml: true });
  const title = parsed.data.title || process.env.POST_TITLE || null;
  const h1 = title ? `<h1>${esc(String(title))}</h1>` : "";
  return `<!doctype html><html><body><article>${h1}${html}</article></body></html>`;
}

const inputPath = resolveInputPath(inputFile);
const htmlContent = inputPath && existsSync(inputPath)
  ? await markdownFileToArticle(inputPath)
  : readFileSync("quartz_page.html", "utf-8");

const dom = new JSDOM(htmlContent);
const doc = dom.window.document;

// Find article content
const article = doc.querySelector("article");
if (!article) {
  console.error("No article found");
  process.exit(1);
}

// Get title (제목 영역에 들어가는 것). markdown 본문에 # 헤딩이 또 있으면 본문에서도 모두 제거하여 중복 방지.
const firstH1 = article.querySelector("h1") || doc.querySelector("h1");
let title = firstH1 ? firstH1.textContent.trim() : "Untitled";
// 본문에 있는 모든 H1 제거 (제목 중복 방지 — 제목은 어차피 별도 필드에 들어감)
article.querySelectorAll("h1").forEach((h) => h.remove());

// Also remove TOC, callout headers, etc.
const tocEl = article.querySelector(".toc");
if (tocEl) tocEl.remove();

// Remove footnotes section
const footnotes = article.querySelectorAll(".footnotes");
footnotes.forEach(f => f.remove());

// Convert article HTML
const out = [];
for (const c of Array.from(article.childNodes)) {
  renderBlockNode(c, out);
}

// 이미지가 있으면 본문 끝에 일괄 정리 섹션 추가
if (imageCollector.items.length > 0) {
  out.push(`<hr style="${T.hr}" />`);
  out.push(`<h2 style="${T.h2}">📷 본문 이미지 (수동 업로드 필요)</h2>`);
  out.push(`<p style="${T.p};color:#888;">본문의 [📷N] 위치에 아래 이미지를 직접 업로드해주세요.</p>`);
  imageCollector.items.forEach((img, i) => {
    const n = i + 1;
    const sectionInfo = img.section ? ` · 위치: <strong style="${T.strong}">${esc(img.section)}</strong>` : "";
    out.push(
      `<p style="${T.p}">` +
      `<strong style="${T.strong}">[📷${n}]</strong> ${esc(img.alt)}${sectionInfo}<br/>` +
      `<a href="${esc(img.src)}" style="${T.a}">${esc(img.src)}</a>` +
      `</p>`
    );
  });
}

const bodyHtml = out.join("");

// Save result
writeFileSync("naver_blog_content.html", bodyHtml, "utf-8");
writeFileSync("naver_blog_title.txt", title, "utf-8");

console.log(`Title: ${title}`);
console.log(`Body HTML length: ${bodyHtml.length}`);
console.log("Saved to naver_blog_content.html");
