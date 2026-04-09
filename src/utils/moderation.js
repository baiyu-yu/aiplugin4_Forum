/**
 * LLM Content Moderation Module
 * Calls an OpenAI-compatible API to review post content
 */
const { getConfig } = require('../database/init');

/**
 * Moderate a post using the configured LLM
 * @param {string} title - Post title
 * @param {string} content - Post content (markdown)
 * @returns {Promise<{approved: boolean, reason: string, raw: string}>}
 */
async function moderateContent(title, content) {
    const enabled = getConfig('llm_enabled');
    if (enabled !== 'true') {
        return { approved: true, reason: '', raw: 'moderation disabled' };
    }

    const systemPrompt = getConfig('llm_prompt');

    const apiUrls = (getConfig('llm_api_url') || '').split(',').map(s => s.trim()).filter(Boolean);
    const apiKeys = (getConfig('llm_api_key') || '').split(',').map(s => s.trim()).filter(Boolean);
    const models = (getConfig('llm_model') || '').split(',').map(s => s.trim()).filter(Boolean);

    if (apiUrls.length === 0 || apiKeys.length === 0) {
        console.warn('LLM moderation enabled but API not configured');
        return { approved: true, reason: '', raw: 'api not configured' };
    }

    const maxIndex = Math.max(apiUrls.length, apiKeys.length, models.length);
    const pick = Math.floor(Math.random() * maxIndex);

    const apiUrl = apiUrls[pick % apiUrls.length];
    const apiKey = apiKeys[pick % apiKeys.length];
    const model = models.length > 0 ? models[pick % models.length] : 'gpt-4o-mini';

    const userMessage = `Title: ${title}\n\nContent:\n${content}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.1,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('LLM API error:', response.status, errText);
            return { approved: true, reason: '', raw: `api error: ${response.status}` };
        }

        const data = await response.json();
        const llmReply = data.choices?.[0]?.message?.content || '';

        // Try to parse JSON response
        try {
            // Extract JSON from response (may contain markdown code block)
            const jsonMatch = llmReply.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    approved: !!parsed.approved,
                    reason: parsed.reason || '',
                    raw: llmReply
                };
            }
        } catch (parseErr) {
            console.warn('Failed to parse LLM response as JSON:', llmReply);
        }

        // Fallback: check for keywords
        const lower = llmReply.toLowerCase();
        if (lower.includes('reject') || lower.includes('denied') || lower.includes('false')) {
            return { approved: false, reason: llmReply, raw: llmReply };
        }

        return { approved: true, reason: '', raw: llmReply };
    } catch (err) {
        console.error('LLM moderation error:', err.message);
        return { approved: true, reason: '', raw: `error: ${err.message}` };
    }
}

module.exports = { moderateContent };
