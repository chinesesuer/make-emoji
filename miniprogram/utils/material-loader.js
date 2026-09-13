function splitIntoBatches(items, batchSize) {
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

function applyTemporaryUrls(materials, urlMap) {
  return materials.map(item => ({ ...item, fileUrl: urlMap[item.fileUrl] || item.fileUrl }));
}

module.exports = { splitIntoBatches, applyTemporaryUrls };
