// Popup script for language selection
document.addEventListener('DOMContentLoaded', async function() {
    const languageOptions = document.getElementById('languageOptions');
    const currentLanguageSpan = document.getElementById('currentLanguage');
    
    // Initialize language manager
    await languageManager.initialize();
    
    // Get current language
    const currentLang = languageManager.getCurrentLanguage();
    const availableLanguages = languageManager.getAvailableLanguages();
    
    // Update current language display
    currentLanguageSpan.textContent = availableLanguages[currentLang]?.name || 'English';
    
    // Populate language options
    Object.entries(availableLanguages).forEach(([code, lang]) => {
        const option = document.createElement('div');
        option.className = `language-option ${code === currentLang ? 'selected' : ''}`;
        option.dataset.language = code;
        
        option.innerHTML = `
            <div class="language-flag">${lang.flag}</div>
            <div class="language-name">${lang.name}</div>
        `;
        
        option.addEventListener('click', async () => {
            // Remove selected class from all options
            document.querySelectorAll('.language-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            
            // Add selected class to clicked option
            option.classList.add('selected');
            
            // Switch language
            const success = languageManager.switchLanguage(code);
            
            if (success) {
                // Update display
                currentLanguageSpan.textContent = lang.name;
                
                // Send message to content script to refresh translations
                try {
                    if (typeof chrome !== 'undefined' && chrome.tabs) {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab && tab.url && tab.url.includes('bilibili.com')) {
                            try {
                                await chrome.tabs.sendMessage(tab.id, {
                                    action: 'switchLanguage',
                                    language: code
                                });
                                showStatusMessage(`Switched to ${lang.name}`, 'success');
                            } catch (messageError) {
                                // Content script not ready or not on BiliBili page
                                showStatusMessage(`Language saved: ${lang.name}`, 'info');
                            }
                        } else {
                            showStatusMessage(`Language saved: ${lang.name}`, 'info');
                        }
                    } else {
                        showStatusMessage(`Language saved: ${lang.name}`, 'info');
                    }
                } catch (error) {
                    console.log('Tab not available or not a BiliBili page:', error);
                    showStatusMessage(`Language saved: ${lang.name}`, 'info');
                }
            } else {
                showStatusMessage('Failed to switch language', 'error');
            }
        });
        
        languageOptions.appendChild(option);
    });
});

// Show status message
function showStatusMessage(message, type = 'info') {
    const status = document.getElementById('status');
    const originalText = status.innerHTML;
    
    status.innerHTML = message;
    status.style.color = type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : 'rgba(255, 255, 255, 0.8)';
    
    setTimeout(() => {
        status.innerHTML = originalText;
        status.style.color = 'rgba(255, 255, 255, 0.8)';
    }, 2000);
} 