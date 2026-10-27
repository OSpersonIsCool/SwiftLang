document.addEventListener('DOMContentLoaded', async () => {
  // Load stats
  const data = await chrome.storage.local.get('srsCards');
  const cards = data.srsCards || [];
  const now = new Date();
  
  const dueCards = cards.filter(c => new Date(c.due) <= now);
  const newCards = cards.filter(c => c.state === 0);
  
  document.getElementById('dueCount').textContent = dueCards.length;
  document.getElementById('newCount').textContent = newCards.length;
  document.getElementById('totalCount').textContent = cards.length;

  // Study button - open SRS interface
  document.getElementById('studyBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('srs.html') });
    window.close();
  });

  // Browse button
  document.getElementById('browseBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('srs.html#browse') });
    window.close();
  });

  // Export to Anki CSV
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get('srsCards');
    const cards = data.srsCards || [];
    
    let csv = 'Front,Back,Tags\n';
    cards.forEach(c => {
      const front = `"${c.word}\\n${c.reading}"`;
      const back = `"${(c.meaningHTML || '').replace(/"/g, '""')}\\n\\n${c.sentenceJP}\\n${c.sentenceEN}"`;
      const tags = `"${(c.tags || []).join(' ')}"`;
      csv += `${front},${back},${tags}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    await chrome.downloads.download({
      url: url,
      filename: `language-srs-${new Date().toISOString().split('T')[0]}.csv`
    });
    
    window.close();
  });
});