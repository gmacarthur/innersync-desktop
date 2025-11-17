module.exports = {
  generateTimetable: require('./src/generate').generateTimetable,
  uploadTimetable: require('./src/apiClient').uploadTimetable,
  loginForToken: require('./src/apiClient').loginForToken,
  clearCachedToken: require('./src/apiClient').clearCachedToken,
  SyncService: require('./src/service').SyncService,
};
