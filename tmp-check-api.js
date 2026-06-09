const fs = require("fs");
const j = fs.readFileSync(process.env.TEMP + "/main.js", "utf8");
const idx = j.indexOf('replace(/\\/$/,""),Xi=Gi?');
console.log("Gi definition:", j.slice(idx - 120, idx + 80));
