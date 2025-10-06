import { createPlugin } from '@/utils';
import style from './style.css?inline';
import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface Song {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
}

interface Playlist {
  name: string;
  songs: Song[];
  created: string;
  modified: string;
}

export default createPlugin({
  name: 'Local Playlist Manager',
  restartNeeded: false,
  config: {
    enabled: false,
    playlistsDir: '',
  },
  stylesheets: [style],
  
  backend: {
    start({ window, ipc, getConfig, setConfig }) {
      const app = require('electron').app;
      const playlistsDir = path.join(app.getPath('userData'), 'local-playlists');
      
      if (!fs.existsSync(playlistsDir)) {
        fs.mkdirSync(playlistsDir, { recursive: true });
      }
      
      setConfig({ playlistsDir });

      ipc.handle('get-local-playlists', async () => {
        try {
          const files = fs.readdirSync(playlistsDir);
          const playlists: Playlist[] = [];
          
          for (const file of files) {
            if (file.endsWith('.json')) {
              const filePath = path.join(playlistsDir, file);
              const content = fs.readFileSync(filePath, 'utf-8');
              playlists.push(JSON.parse(content));
            }
          }
          
          return playlists;
        } catch (error) {
          console.error('Error loading playlists:', error);
          return [];
        }
      });

      ipc.handle('save-playlist', async (event, playlist: Playlist) => {
        try {
          const fileName = `${playlist.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
          const filePath = path.join(playlistsDir, fileName);
          
          playlist.modified = new Date().toISOString();
          if (!playlist.created) {
            playlist.created = playlist.modified;
          }
          
          fs.writeFileSync(filePath, JSON.stringify(playlist, null, 2));
          return { success: true, message: 'Playlist saved successfully' };
        } catch (error) {
          console.error('Error saving playlist:', error);
          return { success: false, message: error.message };
        }
      });

      ipc.handle('delete-playlist', async (event, playlistName: string) => {
        try {
          const fileName = `${playlistName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
          const filePath = path.join(playlistsDir, fileName);
          
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return { success: true, message: 'Playlist deleted successfully' };
          }
          
          return { success: false, message: 'Playlist not found' };
        } catch (error) {
          console.error('Error deleting playlist:', error);
          return { success: false, message: error.message };
        }
      });

      ipc.handle('import-playlist-file', async () => {
        try {
          const result = await dialog.showOpenDialog(window, {
            properties: ['openFile'],
            filters: [
              { name: 'Playlist Files', extensions: ['json', 'txt', 'm3u', 'csv'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });

          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, message: 'Import cancelled' };
          }

          const filePath = result.filePaths[0];
          const content = fs.readFileSync(filePath, 'utf-8');
          const ext = path.extname(filePath).toLowerCase();

          let playlist: Playlist;

          if (ext === '.json') {
            const data = JSON.parse(content);
            playlist = {
              name: data.name || path.basename(filePath, ext),
              songs: data.songs || [],
              created: data.created || new Date().toISOString(),
              modified: new Date().toISOString()
            };
          } else if (ext === '.csv') {
            const lines = content.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
              return { success: false, message: 'Empty CSV file' };
            }

            const header = lines[0].split(',');
            const mediaIdIdx = header.findIndex(h => h.toLowerCase().includes('mediaid'));
            const titleIdx = header.findIndex(h => h.toLowerCase().includes('title'));
            const artistsIdx = header.findIndex(h => h.toLowerCase().includes('artists'));
            const playlistNameIdx = header.findIndex(h => h.toLowerCase().includes('playlistname'));
            const durationIdx = header.findIndex(h => h.toLowerCase().includes('duration'));

            const firstDataRow = lines[1]?.split(',');
            const playlistName = firstDataRow && playlistNameIdx >= 0 
              ? firstDataRow[playlistNameIdx] 
              : path.basename(filePath, ext);

            const songs: Song[] = [];
            
            for (let i = 1; i < lines.length; i++) {
              const parts = lines[i].split(',');
              
              if (parts.length > Math.max(mediaIdIdx, titleIdx, artistsIdx)) {
                songs.push({
                  videoId: mediaIdIdx >= 0 ? parts[mediaIdIdx].trim() : '',
                  title: titleIdx >= 0 ? parts[titleIdx].trim() : parts[1]?.trim() || '',
                  artist: artistsIdx >= 0 ? parts[artistsIdx].trim() : parts[2]?.trim() || 'Unknown',
                  duration: durationIdx >= 0 ? parts[durationIdx].trim() : undefined
                });
              }
            }

            playlist = {
              name: playlistName,
              songs: songs,
              created: new Date().toISOString(),
              modified: new Date().toISOString()
            };
          } else if (ext === '.txt' || ext === '.m3u') {
            const lines = content.split('\n').filter(line => {
              line = line.trim();
              return line && !line.startsWith('#');
            });
            
            playlist = {
              name: path.basename(filePath, ext),
              songs: lines.map(line => {
                const parts = line.split(' - ');
                if (parts.length >= 2) {
                  return {
                    videoId: '',
                    title: parts[1].trim(),
                    artist: parts[0].trim()
                  };
                }
                return {
                  videoId: line.trim(),
                  title: line.trim(),
                  artist: 'Unknown'
                };
              }),
              created: new Date().toISOString(),
              modified: new Date().toISOString()
            };
          } else {
            return { success: false, message: 'Unsupported file format' };
          }

          const fileName = `${playlist.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
          const saveFilePath = path.join(playlistsDir, fileName);
          
          playlist.modified = new Date().toISOString();
          if (!playlist.created) {
            playlist.created = playlist.modified;
          }
          
          fs.writeFileSync(saveFilePath, JSON.stringify(playlist, null, 2));
          return { success: true, message: `Playlist "${playlist.name}" imported with ${playlist.songs.length} songs` };
        } catch (error) {
          console.error('Error importing playlist:', error);
          return { success: false, message: error.message };
        }
      });

      ipc.handle('export-playlist-file', async (event, playlist: Playlist, format: string) => {
        try {
          const result = await dialog.showSaveDialog(window, {
            defaultPath: `${playlist.name}.${format}`,
            filters: [
              { name: 'JSON', extensions: ['json'] },
              { name: 'Plain Text', extensions: ['txt'] },
              { name: 'M3U Playlist', extensions: ['m3u'] },
              { name: 'CSV', extensions: ['csv'] }
            ]
          });

          if (result.canceled || !result.filePath) {
            return { success: false, message: 'Export cancelled' };
          }

          let content: string;

          if (format === 'json') {
            content = JSON.stringify(playlist, null, 2);
          } else if (format === 'csv') {
            content = 'PlaylistName,MediaId,Title,Artists,Duration\n';
            content += playlist.songs.map(song => 
              `${playlist.name},${song.videoId},${song.title},${song.artist},${song.duration || ''}`
            ).join('\n');
          } else if (format === 'txt' || format === 'm3u') {
            if (format === 'm3u') {
              content = '#EXTM3U\n';
              content += playlist.songs.map(song => {
                return `#EXTINF:${song.duration || '-1'},${song.artist} - ${song.title}\n${song.videoId}`;
              }).join('\n');
            } else {
              content = playlist.songs.map(song => 
                `${song.artist} - ${song.title}${song.videoId ? ' [' + song.videoId + ']' : ''}`
              ).join('\n');
            }
          } else {
            return { success: false, message: 'Unsupported format' };
          }

          fs.writeFileSync(result.filePath, content);
          return { success: true, message: 'Playlist exported successfully' };
        } catch (error) {
          console.error('Error exporting playlist:', error);
          return { success: false, message: error.message };
        }
      });
    },

    stop() {
      console.log('Local Playlist Manager stopped');
    }
  },

  renderer: {
    async start(context) {
      console.log('Local Playlist Manager started');

      let currentView: 'list' | 'detail' = 'list';
      let currentPlaylist: Playlist | null = null;

      // Add sidebar navigation item to BOTH mini and full guides
      const addSidebarItem = () => {
        if (document.getElementById('local-playlists-nav')) {
          console.log('Local Playlists: Nav item already exists');
          return;
        }

        // Create nav item for FULL sidebar (with text)
        const navItemFull = document.createElement('div');
        navItemFull.id = 'local-playlists-nav';
        navItemFull.className = 'local-playlists-nav';
        navItemFull.setAttribute('role', 'button');
        navItemFull.setAttribute('tabindex', '0');
        navItemFull.setAttribute('title', 'Local Playlists');
        navItemFull.innerHTML = `
          <div class="nav-item-content">
            <svg viewBox="0 0 24 24" class="nav-icon">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" fill="currentColor"/>
            </svg>
            <span class="nav-text">Local Playlists</span>
          </div>
        `;

        // Create nav item for MINI sidebar (icon only)
        const navItemMini = document.createElement('div');
        navItemMini.id = 'local-playlists-nav-mini';
        navItemMini.className = 'local-playlists-nav mini-mode';
        navItemMini.setAttribute('role', 'button');
        navItemMini.setAttribute('tabindex', '0');
        navItemMini.setAttribute('title', 'Local Playlists');
        navItemMini.innerHTML = `
          <div class="nav-item-content">
            <svg viewBox="0 0 24 24" class="nav-icon">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" fill="currentColor"/>
            </svg>
          </div>
        `;

        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Local Playlists: Nav item clicked');
          showPlaylistsPage();
        };

        navItemFull.addEventListener('click', handleClick);
        navItemMini.addEventListener('click', handleClick);

        // Insert into FULL sidebar (#guide)
        let insertedFull = false;
        const fullGuideItems = document.querySelectorAll('#guide ytmusic-guide-entry-renderer');
        console.log('Local Playlists: Found', fullGuideItems.length, 'full guide items');
        
        for (let item of fullGuideItems) {
          if (item.textContent && item.textContent.includes('Library')) {
            console.log('Local Playlists: Found Library in full guide');
            if (item.parentElement) {
              item.parentElement.insertBefore(navItemFull, item.nextSibling);
              insertedFull = true;
              break;
            }
          }
        }

        // Insert into MINI sidebar (#mini-guide)
        let insertedMini = false;
        const miniGuideItems = document.querySelectorAll('#mini-guide ytmusic-guide-entry-renderer');
        console.log('Local Playlists: Found', miniGuideItems.length, 'mini guide items');
        
        for (let item of miniGuideItems) {
          if (item.textContent && item.textContent.includes('Library')) {
            console.log('Local Playlists: Found Library in mini guide');
            if (item.parentElement) {
              item.parentElement.insertBefore(navItemMini, item.nextSibling);
              insertedMini = true;
              break;
            }
          }
        }

        if (insertedFull || insertedMini) {
          console.log(`Local Playlists: Nav items added - Full: ${insertedFull}, Mini: ${insertedMini}`);
        } else {
          console.error('Local Playlists: Failed to insert into either sidebar');
        }
      };

      // Show main playlists list page
      const showPlaylistsPage = async () => {
        currentView = 'list';
        currentPlaylist = null;

        const mainContent = document.querySelector('ytmusic-app-layout');
        if (!mainContent) return;

        // Clear existing page
        const existingPage = document.getElementById('local-playlists-page');
        if (existingPage) {
          existingPage.remove();
        }

        // Show our page, but don't hide the sidebar or nav
        const ytmusicContent = document.querySelectorAll('ytmusic-browse-response, ytmusic-search-response, ytmusic-player-page');
        ytmusicContent.forEach(el => {
          (el as HTMLElement).style.display = 'none';
        });

        const page = document.createElement('div');
        page.id = 'local-playlists-page';
        page.className = 'local-playlists-page';
        
        const playlists = await context.ipc.invoke('get-local-playlists');

        page.innerHTML = `
          <div class="page-header">
            <h1>Local Playlists</h1>
            <div class="page-actions">
              <button id="import-playlist-btn" class="action-btn">
                <span>📥</span> Import Playlist
              </button>
              <button id="create-from-queue-btn" class="action-btn">
                <span>➕</span> Create from Queue
              </button>
            </div>
          </div>
          <div class="playlists-grid">
            ${playlists.length === 0 ? `
              <div class="empty-state">
                <div class="empty-icon">🎵</div>
                <h2>No local playlists yet</h2>
                <p>Import a playlist or create one from your current queue to get started</p>
              </div>
            ` : playlists.map((playlist: Playlist) => `
              <div class="playlist-card" data-playlist-name="${playlist.name}">
                <div class="playlist-thumbnail">
                  <div class="playlist-icon">🎵</div>
                  <div class="playlist-overlay">
                    <button class="play-btn" title="Play">▶️</button>
                  </div>
                </div>
                <div class="playlist-card-info">
                  <h3>${playlist.name}</h3>
                  <p>${playlist.songs.length} songs</p>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        mainContent.appendChild(page);

        // Add event listeners
        document.getElementById('import-playlist-btn')?.addEventListener('click', async () => {
          const result = await context.ipc.invoke('import-playlist-file');
          if (result.success) {
            showPlaylistsPage();
          }
          alert(result.message);
        });

        document.getElementById('create-from-queue-btn')?.addEventListener('click', async () => {
          await createFromQueue();
          showPlaylistsPage();
        });

        document.querySelectorAll('.playlist-card').forEach(card => {
          card.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const playlistName = (card as HTMLElement).dataset.playlistName!;
            
            if (target.classList.contains('play-btn') || target.closest('.play-btn')) {
              e.stopPropagation();
              playPlaylist(playlistName);
            } else {
              showPlaylistDetail(playlistName);
            }
          });
        });

        // Enable navigation while on our page
        setupNavigationListeners();
      };

      // Show individual playlist detail page
      const showPlaylistDetail = async (playlistName: string) => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const playlist = playlists.find((p: Playlist) => p.name === playlistName);
        
        if (!playlist) {
          alert('Playlist not found');
          return;
        }

        currentView = 'detail';
        currentPlaylist = playlist;

        const existingPage = document.getElementById('local-playlists-page');
        if (existingPage) {
          existingPage.remove();
        }

        const mainContent = document.querySelector('ytmusic-app-layout');
        if (!mainContent) return;

        const page = document.createElement('div');
        page.id = 'local-playlists-page';
        page.className = 'local-playlists-page playlist-detail';

        page.innerHTML = `
          <div class="detail-header">
            <button id="back-btn" class="back-btn">← Back</button>
            <div class="detail-info">
              <div class="detail-thumbnail">🎵</div>
              <div class="detail-text">
                <h1>${playlist.name}</h1>
                <p>${playlist.songs.length} songs</p>
              </div>
            </div>
            <div class="detail-actions">
              <button id="play-all-btn" class="action-btn primary">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                Play All
              </button>
              <button id="shuffle-play-btn" class="action-btn primary">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                </svg>
                Shuffle
              </button>
              <button id="export-playlist-btn" class="action-btn">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/>
                </svg>
                Export
              </button>
              <button id="delete-playlist-btn" class="action-btn danger">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
                Delete
              </button>
            </div>
          </div>
          <div class="songs-list">
            ${playlist.songs.map((song, index) => `
              <div class="song-item" data-index="${index}">
                <span class="song-number">${index + 1}</span>
                <div class="song-info">
                  <div class="song-title">${song.title}</div>
                  <div class="song-artist">${song.artist}</div>
                </div>
                <div class="song-duration">${formatDuration(song.duration)}</div>
              </div>
            `).join('')}
          </div>
        `;

        mainContent.appendChild(page);

        // Event listeners
        document.getElementById('back-btn')?.addEventListener('click', showPlaylistsPage);
        document.getElementById('play-all-btn')?.addEventListener('click', () => playPlaylist(playlistName, false));
        document.getElementById('shuffle-play-btn')?.addEventListener('click', () => playPlaylist(playlistName, true));
        document.getElementById('export-playlist-btn')?.addEventListener('click', () => exportPlaylist(playlistName));
        document.getElementById('delete-playlist-btn')?.addEventListener('click', async () => {
          if (confirm(`Delete playlist "${playlistName}"?`)) {
            const result = await context.ipc.invoke('delete-playlist', playlistName);
            alert(result.message);
            if (result.success) {
              showPlaylistsPage();
            }
          }
        });

        document.querySelectorAll('.song-item').forEach(item => {
          item.addEventListener('click', () => {
            const index = parseInt((item as HTMLElement).dataset.index!);
            const song = playlist.songs[index];
            searchAndPlay(song);
          });
        });

        // Enable navigation
        setupNavigationListeners();
      };

      const formatDuration = (duration?: string): string => {
        if (!duration) return '--:--';
        const seconds = parseInt(duration);
        if (isNaN(seconds)) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };

      const createFromQueue = async () => {
        const name = prompt('Enter playlist name:');
        if (!name) return;

        const songs: Song[] = [];
        
        const queueSelectors = [
          'ytmusic-player-queue-item',
          '#contents ytmusic-player-queue-item',
          'ytmusic-player-queue ytmusic-player-queue-item'
        ];

        let queueItems: NodeListOf<Element> | null = null;
        
        for (const selector of queueSelectors) {
          queueItems = document.querySelectorAll(selector);
          if (queueItems.length > 0) break;
        }

        if (!queueItems || queueItems.length === 0) {
          const videoTitleEl = document.querySelector('.title.ytmusic-player-bar');
          const bylineEl = document.querySelector('.byline.ytmusic-player-bar');
          
          if (videoTitleEl && bylineEl) {
            const videoEl = document.querySelector('video');
            const videoSrc = videoEl?.src || '';
            const videoIdMatch = videoSrc.match(/[?&]v=([^&]+)/);
            
            songs.push({
              videoId: videoIdMatch ? videoIdMatch[1] : '',
              title: videoTitleEl.textContent?.trim() || '',
              artist: bylineEl.textContent?.trim().split('•')[0]?.trim() || ''
            });
          }
        } else {
          queueItems.forEach(item => {
            const titleEl = item.querySelector('.song-title, .title');
            const artistEl = item.querySelector('.byline, .secondary-flex-columns');
            const videoId = item.getAttribute('video-id') || 
                           item.querySelector('[video-id]')?.getAttribute('video-id') || '';
            
            if (titleEl) {
              const artistText = artistEl?.textContent?.trim() || '';
              const artist = artistText.split('•')[0]?.trim() || 'Unknown';
              
              songs.push({
                videoId: videoId,
                title: titleEl.textContent?.trim() || '',
                artist: artist
              });
            }
          });
        }

        if (songs.length === 0) {
          alert('No songs found in queue. Play some music first!');
          return;
        }

        const playlist: Playlist = {
          name,
          songs,
          created: new Date().toISOString(),
          modified: new Date().toISOString()
        };

        const result = await context.ipc.invoke('save-playlist', playlist);
        alert(result.message);
      };

      const exportPlaylist = async (playlistName: string) => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const playlist = playlists.find((p: Playlist) => p.name === playlistName);
        
        if (!playlist) {
          alert('Playlist not found');
          return;
        }

        const format = prompt('Export format? (json/txt/m3u/csv)', 'csv');
        if (!format || !['json', 'txt', 'm3u', 'csv'].includes(format)) {
          return;
        }

        const result = await context.ipc.invoke('export-playlist-file', playlist, format);
        alert(result.message);
      };

      // Setup navigation to allow leaving the playlist page
      const setupNavigationListeners = () => {
        // Listen for clicks on other nav items
        const navItems = document.querySelectorAll('ytmusic-guide-entry-renderer, ytmusic-pivot-bar-item-renderer');
        navItems.forEach(item => {
          item.addEventListener('click', () => {
            // Remove our page when navigating away
            const ourPage = document.getElementById('local-playlists-page');
            if (ourPage) {
              ourPage.remove();
            }
            // Restore hidden content
            const ytmusicContent = document.querySelectorAll('ytmusic-browse-response, ytmusic-search-response, ytmusic-player-page');
            ytmusicContent.forEach(el => {
              (el as HTMLElement).style.display = '';
            });
          });
        });
      };

      const playPlaylist = async (playlistName: string, shuffle: boolean = false) => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const playlist = playlists.find((p: Playlist) => p.name === playlistName);
        
        if (!playlist || playlist.songs.length === 0) {
          alert('Playlist not found or empty');
          return;
        }

        let songs = [...playlist.songs].filter(s => s.videoId);
        
        if (songs.length === 0) {
          alert('No songs with valid video IDs found in this playlist');
          return;
        }

        if (shuffle) {
          for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
          }
        }

        // Try to add songs to queue using YouTube Music's internal API
        try {
          // Play first song
          await playSong(songs[0]);
          
          // Wait for player to load
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Try to add remaining songs to queue
          for (let i = 1; i < songs.length; i++) {
            try {
              // Look for the add to queue function in the page
              const ytmusic = (window as any).ytmusic;
              if (ytmusic && ytmusic.player) {
                ytmusic.player.loadVideoById(songs[i].videoId);
              } else {
                // Fallback: simulate clicking "Add to queue" for each song
                console.log('Would add to queue:', songs[i].title);
              }
            } catch (e) {
              console.error('Failed to add song to queue:', e);
            }
          }
          
          console.log(`Started playlist with ${songs.length} songs`);
        } catch (error) {
          console.error('Error playing playlist:', error);
          alert('Could not play playlist. Playing first song only.');
          playSong(songs[0]);
        }
      };

      const playSong = (song: Song) => {
        if (!song.videoId) {
          alert(`No video ID for: ${song.artist} - ${song.title}`);
          return;
        }

        // Navigate to the video URL
        const videoUrl = `https://music.youtube.com/watch?v=${song.videoId}`;
        console.log('Playing:', videoUrl);
        
        // Navigate to the song
        window.location.href = videoUrl;
      };

      const searchAndPlay = (song: Song) => {
        if (song.videoId) {
          playSong(song);
        } else {
          const query = `${song.artist} ${song.title}`;
          const searchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
          window.location.href = searchUrl;
        }
      };

      const initUI = () => {
        let attempts = 0;
        const maxAttempts = 20;
        
        const checkAndCreate = setInterval(() => {
          attempts++;
          
          // Check for various elements that indicate the app is ready
          const appReady = document.querySelector('ytmusic-app-layout') || 
                          document.querySelector('ytmusic-nav-bar') ||
                          document.querySelector('ytmusic-guide-renderer');
          
          if (appReady) {
            console.log('Local Playlists: App ready, adding nav item...');
            clearInterval(checkAndCreate);
            
            // Wait a bit more for sidebar to fully render
            setTimeout(() => {
              addSidebarItem();
              
              // Verify it was added
              setTimeout(() => {
                const navItem = document.getElementById('local-playlists-nav');
                if (navItem) {
                  console.log('Local Playlists: Nav item successfully added to DOM');
                } else {
                  console.warn('Local Playlists: Nav item not found in DOM after insertion');
                  console.log('Available guide items:', document.querySelectorAll('ytmusic-guide-entry-renderer').length);
                }
              }, 500);
            }, 1000);
          } else if (attempts >= maxAttempts) {
            clearInterval(checkAndCreate);
            console.error('Local Playlists: Timeout waiting for app to load');
          }
        }, 500);
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
      } else {
        initUI();
      }
    },

    stop() {
      const ui = document.getElementById('local-playlists-page');
      if (ui) {
        ui.remove();
      }
      const nav = document.getElementById('local-playlists-nav');
      if (nav) {
        nav.remove();
      }
    }
  }
});
