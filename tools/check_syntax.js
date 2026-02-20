const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'main.js');
try {
    const c = fs.readFileSync(p, 'utf8');
    try {
        new Function(c);
        console.log('PARSE_OK');
    } catch (e) {
        console.error('PARSE_ERROR');
        console.error(e && e.stack || e);
        process.exit(2);
    }
} catch (e) {
    console.error('READ_FAILED', e && e.stack || e);
    process.exit(3);
}
