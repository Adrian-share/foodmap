import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
const schema=JSON.parse(fs.readFileSync(new URL('./node_modules/@earendil-works/pi-coding-agent/schemas/models.schema.json',import.meta.url)));
const config=JSON.parse(fs.readFileSync(process.argv[2]));
const ajv=new Ajv({strict:false});
if(!ajv.validate(schema,config))process.exit(1);
