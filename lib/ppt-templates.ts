// PPT模板系统 - 定义幻灯片类型和提示词模板

export type SlideType = 'title' | 'content' | 'section' | 'closing' | 'image' | 'quote' | 'two-column';

export type StylePreset = 'business' | 'tech' | 'minimal' | 'creative' | 'academic';

export interface SlideTemplate {
  type: SlideType;
  displayName: string;
  description: string;
  promptTemplate: (content: string, style: string) => string;
}

// 风格预设 - 这些会被添加到每个提示词前面以确保视觉一致性
export const STYLE_PRESETS: Record<StylePreset, {
  name: string;
  description: string;
  basePrompt: string;
}> = {
  business: {
    name: '商务专业',
    description: '专业企业演示风格，清晰布局，深蓝白配色',
    basePrompt: 'professional corporate presentation style, clean modern layout, navy blue and white color scheme, sans-serif typography, business graphics, high-end professional design, 16:9 aspect ratio, minimalist elegant',
  },
  tech: {
    name: '科技未来',
    description: '现代科技风格，渐变背景，蓝紫配色，未来感UI',
    basePrompt: 'modern tech presentation design, gradient backgrounds, vibrant blue and purple colors, futuristic UI elements, digital aesthetic, sleek typography, tech-focused visuals, 16:9 aspect ratio, innovation theme',
  },
  minimal: {
    name: '极简优雅',
    description: '极简主义设计，大量留白，单色调，优雅字体',
    basePrompt: 'minimalist presentation design, lots of whitespace, monochrome palette with one accent color, elegant serif fonts, simple geometric shapes, clean composition, 16:9 aspect ratio, sophisticated minimal',
  },
  creative: {
    name: '创意活力',
    description: '创意风格，大胆配色，动态布局，艺术字体',
    basePrompt: 'creative presentation style, bold vibrant colors, dynamic asymmetric layouts, artistic typography, playful design elements, energetic composition, 16:9 aspect ratio, creative agency style',
  },
  academic: {
    name: '学术正式',
    description: '学术演示模板，正式布局，传统配色，研究导向',
    basePrompt: 'academic presentation template, formal structured layout, traditional color scheme, research-focused design, clear hierarchical typography, scholarly aesthetic, 16:9 aspect ratio, professional academic',
  },
};

// 幻灯片模板定义
export const SLIDE_TEMPLATES: Record<SlideType, SlideTemplate> = {
  title: {
    type: 'title',
    displayName: '标题页',
    description: '演示文稿的首页，包含主标题和副标题',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation title slide, centered layout, large bold title text: "${content}", subtitle area, professional opening slide, impactful first impression, clean background`,
  },

  content: {
    type: 'content',
    displayName: '内容页',
    description: '标准内容页面，包含标题和要点内容',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation content slide, title at top, bullet points or text content: "${content}", balanced composition, readable layout, information hierarchy, professional slide design`,
  },

  section: {
    type: 'section',
    displayName: '章节页',
    description: '章节分隔页，用于标记新的主题部分',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation section divider slide, bold section title: "${content}", transitional design, chapter break aesthetic, impactful typography, clean minimal background`,
  },

  closing: {
    type: 'closing',
    displayName: '结束页',
    description: '演示文稿的结束页，感谢或总结',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation closing slide, final message: "${content}", thank you slide aesthetic, memorable ending design, professional conclusion, polished finishing slide`,
  },

  image: {
    type: 'image',
    displayName: '图片页',
    description: '以图片为主的页面，配有简短说明',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation image-focused slide, large visual area, caption or description: "${content}", image-centric layout, visual storytelling, minimal text overlay`,
  },

  quote: {
    type: 'quote',
    displayName: '引用页',
    description: '展示引用或重要语句',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation quote slide, centered quotation: "${content}", attribution area, typographic emphasis, inspirational design, impactful quote presentation`,
  },

  'two-column': {
    type: 'two-column',
    displayName: '双栏页',
    description: '两栏布局，用于对比或并列内容',
    promptTemplate: (content: string, style: string) =>
      `${style}, presentation two-column slide, split layout, left and right content areas: "${content}", comparison design, balanced dual-content layout, organized information`,
  },
};

// 默认幻灯片结构生成器
export function generateDefaultSlideStructure(
  theme: string,
  slideCount: number,
): Array<{ type: SlideType; content: string }> {
  const slides: Array<{ type: SlideType; content: string }> = [];

  // 第一页：标题页
  slides.push({
    type: 'title',
    content: theme,
  });

  // 中间页：根据数量分配
  const middleCount = slideCount - 2; // 减去首尾两页

  for (let i = 0; i < middleCount; i++) {
    // 每3-4页插入一个章节页
    if (i > 0 && i % 4 === 0) {
      slides.push({
        type: 'section',
        content: `${theme} - Part ${Math.floor(i / 4) + 1}`,
      });
    } else {
      // 混合使用不同类型的内容页
      const types: SlideType[] = ['content', 'content', 'image', 'two-column'];
      const selectedType = types[i % types.length];
      slides.push({
        type: selectedType,
        content: `${theme} - Content ${i + 1}`,
      });
    }
  }

  // 最后一页：结束页
  if (slideCount > 1) {
    slides.push({
      type: 'closing',
      content: 'Thank You',
    });
  }

  return slides;
}

// 生成完整的提示词
export function generateSlidePrompt(
  slideType: SlideType,
  content: string,
  style: StylePreset,
  seed?: number
): string {
  const stylePreset = STYLE_PRESETS[style];
  const template = SLIDE_TEMPLATES[slideType];

  let prompt = template.promptTemplate(content, stylePreset.basePrompt);

  // 添加种子以保持一致性
  if (seed !== undefined) {
    prompt += `, consistent visual style, seed: ${seed}`;
  }

  return prompt;
}

// 为整个PPT生成一致的种子
export function generatePPTSeed(): number {
  return Math.floor(Math.random() * 1000000);
}

// 用于编辑的幻灯片内容提取
export function extractSlideContent(prompt: string): string {
  // 尝试从提示词中提取用户内容
  const match = prompt.match(/[""](.+?)[""]|: (.+?),/);
  return match ? (match[1] || match[2] || '').trim() : '';
}
