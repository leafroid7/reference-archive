const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { action, filter_brand, filter_date_start, filter_date_end, page_size, start_cursor, sort_dir } = req.query;

  try {
    if (action === 'getPages') {
      const filters = [];

      if (filter_brand) {
        filters.push({
          property: '브랜드명',
          select: { equals: filter_brand }
        });
      }

      if (filter_date_start) {
        filters.push({
          property: '날짜',
          date: { on_or_after: filter_date_start }
        });
      }

      if (filter_date_end) {
        filters.push({
          property: '날짜',
          date: { on_or_before: filter_date_end }
        });
      }

      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: filters.length > 0 ? { and: filters } : undefined,
        sorts: [{ property: '날짜', direction: sort_dir === 'ascending' ? 'ascending' : 'descending' }],
        page_size: page_size ? parseInt(page_size) : 20,
        ...(start_cursor ? { start_cursor } : {})
      });

      async function fetchBlocksRecursive(blockId) {
        const r = await notion.blocks.children.list({ block_id: blockId });
        const results = await Promise.all(
          r.results.map(async (block) => {
            if (block.has_children && ['column_list','column','toggle','bulleted_list_item','numbered_list_item','quote','callout'].includes(block.type)) {
              block.children = await fetchBlocksRecursive(block.id);
            }
            return block;
          })
        );
        return results;
      }

      const pages = await Promise.all(
        response.results.map(async (page) => {
          const blocks = await fetchBlocksRecursive(page.id);
          return { ...page, _id: page.id.replace(/-/g, ''), blocks };
        })
      );

      res.json({ pages, next_cursor: response.next_cursor, has_more: response.has_more });

    } else if (action === 'createPage') {
      const body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(JSON.parse(data)));
      });

      const { properties: p, mediaUrls = [] } = body;

      const newPage = await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          '콘텐츠': { title: [{ text: { content: p['콘텐츠'] || '' } }] },
          ...(p['브랜드명'] ? { '브랜드명': { select: { name: p['브랜드명'] } } } : {}),
          ...(p['날짜'] ? { '날짜': { date: { start: p['날짜'] } } } : {}),
          ...(p['카피 유형']?.length ? { '카피 유형': { multi_select: p['카피 유형'].map(n => ({ name: n })) } } : {}),
          ...(p['브랜드 개요'] ? { '브랜드 개요': { rich_text: [{ text: { content: p['브랜드 개요'] } }] } } : {}),
          ...(p['주목할 캠페인/콘텐츠'] ? { '주목할 캠페인/콘텐츠': { rich_text: [{ text: { content: p['주목할 캠페인/콘텐츠'] } }] } } : {}),
          ...(p['적용해 볼 아이디어'] ? { '적용해 볼 아이디어': { rich_text: [{ text: { content: p['적용해 볼 아이디어'] } }] } } : {}),
          ...(p['인사이트 (내가 배운 것)'] ? { '인사이트 (내가 배운 것)': { rich_text: [{ text: { content: p['인사이트 (내가 배운 것)'] } }] } } : {}),
          ...(p['출처 URL'] ? { '출처 URL': { url: p['출처 URL'] } } : {}),
          ...(p['태그']?.length ? { '태그': { multi_select: p['태그'].map(n => ({ name: n })) } } : {}),
        }
      });

      // 미디어 URL을 페이지 본문 블록으로 추가
      if (mediaUrls.length > 0) {
        const getYouTubeId = (url) => {
          const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          return m ? m[1] : null;
        };
        const children = mediaUrls.map(url => {
          const ytId = getYouTubeId(url);
          if (ytId) return { object: 'block', type: 'embed', embed: { url: `https://www.youtube.com/watch?v=${ytId}` } };
          if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || url.includes('images') || !url.includes('.com/watch')) {
            return { object: 'block', type: 'image', image: { type: 'external', external: { url } } };
          }
          return { object: 'block', type: 'embed', embed: { url } };
        });
        await notion.blocks.children.append({ block_id: newPage.id, children });
      }

      res.json({ success: true, pageId: newPage.id });

    } else if (action === 'updateMedia') {
      const body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(JSON.parse(data)));
      });
      const { pageId, mediaUrls = [] } = body;

      // 기존 블록 목록 가져와서 미디어 블록 ID 수집
      const existingBlocks = await notion.blocks.children.list({ block_id: pageId });
      const mediaBlockIds = existingBlocks.results
        .filter(b => ['image','video','embed','bookmark'].includes(b.type))
        .map(b => b.id);

      // 기존 미디어 블록 삭제
      await Promise.all(mediaBlockIds.map(id => notion.blocks.delete({ block_id: id })));

      // 새 순서로 블록 추가
      if (mediaUrls.length > 0) {
        const getYouTubeId = (url) => {
          const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          return m ? m[1] : null;
        };
        const children = mediaUrls.map(url => {
          const ytId = getYouTubeId(url);
          if (ytId) return { object: 'block', type: 'embed', embed: { url: `https://www.youtube.com/watch?v=${ytId}` } };
          return { object: 'block', type: 'image', image: { type: 'external', external: { url } } };
        });
        await notion.blocks.children.append({ block_id: pageId, children });
      }
      res.json({ success: true });

    } else if (action === 'updatePage') {
      const body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(JSON.parse(data)));
      });

      const { pageId, properties } = body;
      const updateProps = {};

      if (properties['콘텐츠']) updateProps['콘텐츠'] = { title: [{ text: { content: properties['콘텐츠'] } }] };
      if (properties['브랜드명']) updateProps['브랜드명'] = { select: { name: properties['브랜드명'] } };
      if (properties['날짜']) updateProps['날짜'] = { date: { start: properties['날짜'] } };
      if (properties['브랜드 개요'] !== undefined) updateProps['브랜드 개요'] = { rich_text: [{ text: { content: properties['브랜드 개요'] } }] };
      if (properties['주목할 캠페인/콘텐츠'] !== undefined) updateProps['주목할 캠페인/콘텐츠'] = { rich_text: [{ text: { content: properties['주목할 캠페인/콘텐츠'] } }] };
      if (properties['적용해 볼 아이디어'] !== undefined) updateProps['적용해 볼 아이디어'] = { rich_text: [{ text: { content: properties['적용해 볼 아이디어'] } }] };
      if (properties['인사이트 (내가 배운 것)'] !== undefined) updateProps['인사이트 (내가 배운 것)'] = { rich_text: [{ text: { content: properties['인사이트 (내가 배운 것)'] } }] };
      if (properties['출처 URL'] !== undefined) updateProps['출처 URL'] = { url: properties['출처 URL'] || null };

      await notion.pages.update({ page_id: pageId, properties: updateProps });
      res.json({ success: true });

    } else if (action === 'getBrands') {
      const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
      const brands = db.properties['브랜드명']?.select?.options || [];
      res.json({ brands });

    } else {
      res.status(400).json({ error: 'Unknown action' });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
