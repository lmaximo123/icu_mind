/* Schema gate only. This module never loads or executes probabilistic models. */
'use strict';
const required=['id','version','artifactDigest','outcome','horizon','population','featureSchemaVersion','calibrationReport','temporalValidationReport','externalValidationReport','monitoringPlan','rollbackVersion','independentReview'];
function inspect(record){
 const missing=required.filter(key=>typeof record?.[key]!=='string'||!record[key].trim());
 return {status:'disabled',missing,reason:'No probabilistic runtime or institutional authorization. Metadata completeness is not validation.',
  onlineLearning:false,realDataTraining:false};
}
module.exports={schemaVersion:1,inspect};
