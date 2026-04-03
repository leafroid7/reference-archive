const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { action, filter_brand, filter_date_start, filter_date_end } = req.query;

  try {
    if (action === 'getPages') {
      const filters = [];

      if (filter_brand) {
        filters.push({
          property: '브랜드명',
          multi_select: { contains: filter_brand }
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
        sorts: [{ property: '날짜', direction: 'descending' }]
      });

      // 각 페이지의 블록(이미지, 영상) 가져오기
      const pages = await Promise.all(
        response.results.map(async (page) => {
          const blocks = await notion.blocks.children.list({ block_id: page.id });
          return { ...page, blocks: blocks.results };
        })
      );

      res.json({ pages });

    } else if (action === 'getBrands') {
      const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
      const brands = db.properties['브랜드명']?.multi_select?.options || [];
      res.json({ brands });

    } else if (action === 'addReaction') {
      // 반응은 Notion에 저장하지 않고 브라우저 로컬에 저장 (아래 설명 참고)
      res.json({ ok: true });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};