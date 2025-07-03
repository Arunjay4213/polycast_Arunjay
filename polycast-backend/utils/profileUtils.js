// Helper function to get default language for a profile
function getDefaultLanguageForProfile(profile) {
    const languageMap = {
        cat: 'Spanish',
        dog: 'French',
        mouse: 'German',
        horse: 'Italian',
        lizard: 'Portuguese',
        shirley: 'Chinese'
    };
    return languageMap[profile] || 'Spanish';
}

module.exports = {
    getDefaultLanguageForProfile
};
