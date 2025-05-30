const fs = require("fs"); // Only if using Node.js
const firstObjectArray = require('./Electricity.json')
const secondObjectArray = require('./Gas.json')
const thirdObjectArray = require('./Water.json')
const secondObject = require('./blockMapping.json')
const blockMapping = require('./blockMapping.json');

function calculateTimeDifferences(arrayOfObjects, validationObj) {
    const allDifferences = [];
    
    for (const key in validationObj) {
        const validatingObj = validationObj[key];
        const validationTime = new Date(validatingObj.validationTime);
        
        const differences = arrayOfObjects
            .filter(item => validatingObj.blockIds.includes(item.blockId))
            .map(item => {
                const initialTime = new Date(item.timestamp);
                const differenceMs = validationTime - initialTime;
                return differenceMs / 1000; // Convert to seconds
            });
        
        allDifferences.push(...differences);
    }
    
    return allDifferences;
}

// Add function to calculate blockIds
function calculateTotalBlockIds() {
    try {
      let totalBlockIds = 0;
      let blockCounts = {};
  
      // Calculate total and per-block counts
      for (const key in blockMapping) {
        const blockIds = blockMapping[key].blockIds;
        totalBlockIds += blockIds.length;
        blockCounts[key] = blockIds.length;
      }
  
      console.log('\n=== Block Mapping Statistics ===');
      console.log(`Total number of blockIds: ${totalBlockIds}`);
      console.log('\nBlock counts per mapping:');
      for (const key in blockCounts) {
        console.log(`Mapping ${key}: ${blockCounts[key]} blocks`);
      }
  
      return totalBlockIds;
    } catch (error) {
      console.error('Error calculating blockIds:', error);
      return 0;
    }
  }

// Combine arrays more efficiently
const allObjects = [...firstObjectArray, ...secondObjectArray, ...thirdObjectArray];
const results = calculateTimeDifferences(allObjects, secondObject);
calculateTotalBlockIds()
// Write results to file
fs.writeFileSync('batch-100-tx-300.json', JSON.stringify({ results }, null, 2));
  