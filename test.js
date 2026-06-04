const fs = require('fs');
const blockBefore = '';
if (blockBefore.endsWith('<Can action={''file.*''}>\n') || blockBefore.endsWith('<Can action={"file.*"}>\n')) {
    console.log('Valid');
}
