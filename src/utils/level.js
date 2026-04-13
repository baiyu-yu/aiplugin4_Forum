const { getDb } = require('../database/init');

const EXP_POST = 10;
const EXP_COMMENT = 5;
const EXP_UPVOTE = 2; // (Not used explicitly unless we hook into vote route, but good for reference)

/**
 * Grant experience to a user and potentially level them up.
 * Rule: Next level requires (current_level^2 * 20) exp to reach.
 * @param {number} userId 
 * @param {number} expGain 
 * @returns {object} { level, exp, leveledUp }
 */
function addExp(userId, expGain) {
    const db = getDb();
    const user = db.prepare('SELECT level, exp FROM users WHERE id = ?').get(userId);
    if (!user) return { level: 1, exp: 0, leveledUp: false };

    let currentExp = (user.exp || 0) + expGain;
    let currentLevel = user.level || 1;
    let leveledUp = false;

    // Level up logic
    while (currentExp >= currentLevel * currentLevel * 20) {
        currentLevel++;
        leveledUp = true;
    }

    db.prepare('UPDATE users SET exp = ?, level = ? WHERE id = ?').run(currentExp, currentLevel, userId);

    return { level: currentLevel, exp: currentExp, leveledUp };
}

module.exports = { addExp, EXP_POST, EXP_COMMENT, EXP_UPVOTE };
