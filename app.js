process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const dig = require('node-dig-dns');
const path = require('path');

const app = express();
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(new Error('Only CSV files allowed'));
    }
    cb(null, true);
  }
});

// Add this near the top of app.js with other constants
const PROVIDER_MAPPINGS = [
  { pattern: /\.mail\.protection\.outlook\.com$/i, provider: 'office365' },
  { pattern: /smtp\.google\.com$/i, provider: 'gsuite' },
  { pattern: /messagingengine\.com$/i, provider: 'fastmail' }
  // Add more mappings as needed
];

function getEmailProvider(mxRecord) {
  if (!mxRecord || mxRecord === 'failed') return '';
  
  const match = PROVIDER_MAPPINGS.find(mapping => mapping.pattern.test(mxRecord));
  return match ? match.provider : '';
}

async function getMXRecord(domain) {
    try {
      const result = await dig([domain, 'MX'], { timeout: 2000 });
      
      // Debug logging
      console.log('DIG Response:', JSON.stringify(result, null, 2));
  
      // Parse answer section
      const mxRecords = (result.answer || [])
        .filter(a => a.type === 'MX' && a.value && a.value.server)
        .sort((a, b) => 
          parseInt(a.value.priority || 0) - parseInt(b.value.priority || 0)
        );
  
      if (mxRecords.length) {
        // Remove trailing dot and return lowest priority server
        return mxRecords[0].value.server.replace(/\.$/, '').toLowerCase();
      }
  
      console.log(`No MX records found for domain: ${domain}`);
      return '';
    } catch (error) {
      console.error(`MX lookup failed for ${domain}:`, error);
      return 'failed';
    }
  }

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', upload.single('csvFile'), async (req, res) => {
  try {
    const records = parse(req.file.buffer, { columns: true });
    const emailColumn = Object.keys(records[0]).find(key => 
      key.toLowerCase().includes('email'));
    
    if (!emailColumn) {
      throw new Error('No email column found');
    }

    const processedRecords = await Promise.all(records.map(async (record) => {
        const email = record[emailColumn];
        if (!email?.includes('@')) {
          return { ...record, mx: 'failed', emailprovider: '' };
        }
        const domain = email.split('@')[1];
        const mxRecord = await getMXRecord(domain);
        const emailProvider = getEmailProvider(mxRecord);
        return { 
          ...record, 
          mx: mxRecord,
          emailprovider: emailProvider 
        };
      }));

    const output = stringify(processedRecords, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=result.csv');
    res.send(output);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
  });