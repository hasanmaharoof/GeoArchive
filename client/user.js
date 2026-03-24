import { API_BASE_URL } from './config.js';
import { auth, onAuthStateChanged } from './auth.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getViewingUsername() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'user' && pathParts[1]) return pathParts[1];
  const params = new URLSearchParams(window.location.search);
  return params.get('username');
}

async function loadUserProfile() {
  const username = getViewingUsername();

  if (!username) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = 'No username provided';
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/user/${encodeURIComponent(username)}`);

    if (!response.ok) {
      throw new Error(response.status === 404 ? 'User not found' : 'Failed to load profile');
    }

    const userData = await response.json();

    document.title = `@${userData.username}'s Profile`;
    document.getElementById('avatar-letter').textContent = userData.username.charAt(0).toUpperCase();
    document.getElementById('username').textContent = `@${escapeHtml(userData.username)}`;
    document.getElementById('joined-date').textContent = userData.created_at
      ? new Date(userData.created_at).toDateString()
      : 'Unknown';
    document.getElementById('bio-text').textContent = userData.bio || 'No bio yet.';
    document.getElementById('submission-count').textContent = userData.submissionCount;
    document.getElementById('view-submissions').href = `/database.html?uploader=${encodeURIComponent(userData.username)}`;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('profile-content').style.display = 'block';

    setupBioEditor(userData.username, userData.bio || '');

  } catch (err) {
    console.error('Error loading profile:', err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = err.message;
  }
}

function setupBioEditor(viewingUsername, currentBio) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      const meRes = await fetch(`${API_BASE_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!meRes.ok) return;
      const meData = await meRes.json();
      if (meData.username !== viewingUsername) return;
    } catch {
      return;
    }

    // Add edit link to bio header using existing CSS class
    const bioHeader = document.getElementById('bio-header');
    bioHeader.innerHTML = `Bio <a href="#" id="edit-bio-link" class="edit-bio-link">(edit bio)</a>`;

    // Add modal to DOM using existing CSS classes
    document.body.insertAdjacentHTML('beforeend', `
      <div id="bio-overlay"></div>
      <div id="bio-modal">
        <h3>Edit Bio</h3>
        <textarea id="bio-input" rows="3" maxlength="300"></textarea>
        <div class="modal-buttons">
          <button id="save-bio-btn" class="btn">Save</button>
          <button id="close-bio-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    `);

    const overlay = document.getElementById('bio-overlay');
    const modal = document.getElementById('bio-modal');
    const input = document.getElementById('bio-input');

    document.getElementById('edit-bio-link').addEventListener('click', (e) => {
      e.preventDefault();
      input.value = document.getElementById('bio-text').textContent === 'No bio yet.'
        ? ''
        : document.getElementById('bio-text').textContent;
      modal.style.display = 'block';
      overlay.style.display = 'block';
      input.focus();
    });

    const closeModal = () => {
      modal.style.display = 'none';
      overlay.style.display = 'none';
    };

    document.getElementById('close-bio-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    document.getElementById('save-bio-btn').addEventListener('click', async () => {
      const newBio = input.value.trim();
      const saveBtn = document.getElementById('save-bio-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE_URL}/api/user/bio`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ bio: newBio })
        });

        if (res.ok) {
          document.getElementById('bio-text').textContent = newBio || 'No bio yet.';
          closeModal();
        } else {
          alert('Failed to save bio. Please try again.');
        }
      } catch (err) {
        console.error('Bio save error:', err);
        alert('Network error. Please try again.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', loadUserProfile);