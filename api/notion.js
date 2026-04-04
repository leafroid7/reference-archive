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
        sorts: [{ property: '날짜', direction: 'descending' }]
      });

      async function fetchBlocksRecursive(blockId) {
        const r = await notion.blocks.children.list({ block_id: blockId });
        const results = await Promise.all(
          r.results.map(async (block) => {
            if (block.has_children && (block.type === 'column_list' || block.type === 'column')) {
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

      res.json({ pages });

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
