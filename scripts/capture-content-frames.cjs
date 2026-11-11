// Compatibility entrypoint; use the maintained capture/review/import workflow.
if(process.argv.length===2)process.argv.push('capture');
require('./screenshots.cjs').main().catch(e=>{console.error(e.message);process.exitCode=1;});
