/**
 * Generate file tree from debug_response.html
 * Usage: node generate_tree.js
 */
import fs from 'fs';
import * as cheerio from 'cheerio';

// Load HTML
const debugFile = './debug_response.html';

if (!fs.existsSync(debugFile)) {
  console.error('❌ debug_response.html not found');
  process.exit(1);
}

const html = fs.readFileSync(debugFile, 'utf8');
console.log(`Loaded ${debugFile} (${html.length} chars)\n`);

// Parse the HTML
const $ = cheerio.load(html);

// Find main-grid-table
const $table = $('table.main-grid-table');
if ($table.length === 0) {
  console.error('❌ No main-grid-table found');
  process.exit(1);
}

// Get column headers
const headers = [];
$table.find('thead th').each((_, th) => {
  const $th = $(th);
  const name = $th.attr('data-name') || $th.find('.main-grid-head-title').text().trim().toUpperCase();
  headers.push(name);
});

const nameIdx = headers.findIndex(h => h === 'NAME');
const activeIdx = headers.findIndex(h => h === 'ACTIVE');
const sortIdx = headers.findIndex(h => h === 'SORT');
const dateIdx = headers.findIndex(h => h.includes('TIMESTAMP') || h.includes('DATE'));
const idIdx = headers.findIndex(h => h === 'ID');

// Parse sections
const sections = [];
const elements = [];

$table.find('tbody tr.main-grid-row').each((_, row) => {
  const $row = $(row);
  const rowId = $row.attr('data-id');

  if (rowId === 'template_0' || rowId?.startsWith('template_')) {
    return;
  }

  const cells = $row.find('td.main-grid-cell');
  if (cells.length === 0) return;

  let name = '';
  if (nameIdx >= 0 && cells[nameIdx]) {
    const nameCell = $(cells[nameIdx]);
    name = nameCell.find('.main-grid-cell-content').text().trim() ||
           nameCell.find('a.adm-list-table-link').text().trim() ||
           nameCell.text().trim();
  }

  if (!name || name.length < 2) return;
  if (name.toLowerCase().includes('название') || name.toLowerCase().includes('name')) return;

  let active = '';
  if (activeIdx >= 0 && cells[activeIdx]) {
    active = $(cells[activeIdx]).find('.main-grid-cell-content').text().trim();
  }

  let sort = '';
  if (sortIdx >= 0 && cells[sortIdx]) {
    sort = $(cells[sortIdx]).find('.main-grid-cell-content').text().trim();
  }

  let date = '';
  if (dateIdx >= 0 && cells[dateIdx]) {
    date = $(cells[dateIdx]).find('.main-grid-cell-content').text().trim();
  }

  let id = '';
  if (idIdx >= 0 && cells[idIdx]) {
    id = $(cells[idIdx]).find('.main-grid-cell-content').text().trim() || rowId?.replace('S', '') || '';
  }

  const isSection = rowId?.startsWith('S');

  const item = {
    id: id,
    rowId: rowId,
    name: name,
    active: active === 'Да' || active === 'Y',
    sort: parseInt(sort, 10) || 0,
    date: date,
    type: isSection ? 'section' : 'element'
  };

  if (isSection) {
    sections.push(item);
  } else {
    elements.push(item);
  }
});

// Sort sections by sort order
sections.sort((a, b) => a.sort - b.sort);
elements.sort((a, b) => a.sort - b.sort);

// Build output
const output = [];
output.push('═'.repeat(60));
output.push('  BITRIX FILE MANAGER - STRUCTURE TREE');
output.push('═'.repeat(60));
output.push(`Generated: ${new Date().toLocaleString('ru-RU')}`);
output.push(`Source: ${debugFile}`);
output.push(`Total Sections: ${sections.length}`);
output.push(`Total Elements: ${elements.length}`);
output.push('═'.repeat(60));
output.push('');

// Print sections
if (sections.length > 0) {
  output.push(`📁 SECTIONS (${sections.length}):`);
  output.push('-'.repeat(40));
  sections.forEach((item, index) => {
    const isLast = index === sections.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    output.push(`${connector}📁 ${item.name}`);
    output.push(`    ID: ${item.id} | Sort: ${item.sort} | Active: ${item.active ? 'Yes' : 'No'}`);
    if (item.date) {
      output.push(`    Date: ${item.date}`);
    }
    output.push('');
  });
}

// Print elements
if (elements.length > 0) {
  output.push(`\n📄 ELEMENTS (${elements.length}):`);
  output.push('-'.repeat(40));
  elements.forEach((item, index) => {
    const isLast = index === elements.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    output.push(`${connector}📄 ${item.name}`);
    output.push(`    ID: ${item.id} | Active: ${item.active ? 'Yes' : 'No'}`);
    output.push('');
  });
}

const result = output.join('\n');
console.log(result);

// Save to file
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = `bitrix_tree_${timestamp}.txt`;
fs.writeFileSync(outputFile, result, 'utf8');
console.log(`\n💾 Tree saved to: ${outputFile}`);
