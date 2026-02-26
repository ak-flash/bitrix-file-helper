const fileName = 'документ 26 марта.3';
const corrupted = Buffer.from(fileName, 'binary').toString('utf8');
console.log(corrupted);
