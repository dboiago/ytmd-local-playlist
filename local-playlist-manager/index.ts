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
    playlistsDir: '', // Will be set to app data directory
  },
  stylesheets: [style],
  
  backend: {
    start({ window, ipc, getConfig, setConfig }) {
      const app = require('electron').app;
      const playlistsDir = path.join(app.getPath('userData'), 'local-playlists');
      
      // Create playlists directory if it doesn't exist
      if (!fs.existsSync(playlistsDir)) {
        fs.mkdirSync(playlistsDir, { recursive: true });
      }
      
      setConfig({ playlistsDir });

      // Get all local playlists
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

      // Save playlist
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

      // Delete playlist
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

      // Import playlist from file
      ipc.handle('import-playlist-file', async () => {
        try {
          const result = await dialog.showOpenDialog(window, {
            properties: ['openFile'],
            filters: [
              { name: 'Playlist Files', extensions: ['json', 'txt', 'm3u'] },
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
            // Import JSON format
            const data = JSON.parse(content);
            playlist = {
              name: data.name || path.basename(filePath, ext),
              songs: data.songs || [],
              created: data.created || new Date().toISOString(),
              modified: new Date().toISOString()
            };
          } else if (ext === '.txt' || ext === '.m3u') {
            // Import text/m3u format (one song per line: "Artist - Title" or video ID)
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
                    videoId: '', // Will be searched when played
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

          // Save the imported playlist
          const saveResult = await ipc.invoke('save-playlist', playlist);
          return saveResult;
        } catch (error) {
          console.error('Error importing playlist:', error);
          return { success: false, message: error.message };
        }
      });

      // Export playlist to file
      ipc.handle('export-playlist-file', async (event, playlist: Playlist, format: string) => {
        try {
          const result = await dialog.showSaveDialog(window, {
            defaultPath: `${playlist.name}.${format}`,
            filters: [
              { name: 'JSON', extensions: ['json'] },
              { name: 'Plain Text', extensions: ['txt'] },
              { name: 'M3U Playlist', extensions: ['m3u'] }
            ]
          });

          if (result.canceled || !result.filePath) {
            return { success: false, message: 'Export cancelled' };
          }

          let content: string;

          if (format === 'json') {
            content = JSON.stringify(playlist, null, 2);
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

    onConfigChange(newConfig) {
      console.log('Playlist manager config changed:', newConfig);
    },

    stop() {
      console.log('Local Playlist Manager stopped');
    }
  },

  renderer: {
    async start(context) {
      console.log('Local Playlist Manager started');

      // Create UI for playlist management
      const createPlaylistUI = () => {
        // Check if UI already exists
        if (document.getElementById('local-playlist-manager')) {
          return;
        }

        const container = document.createElement('div');
        container.id = 'local-playlist-manager';
        container.className = 'local-playlist-manager';
        container.innerHTML = `
          <div class="playlist-manager-header">
            <h3>Local Playlists</h3>
            <div class="playlist-actions">
              <button id="import-playlist-btn" title="Import Playlist">📥 Import</button>
              <button id="create-playlist-btn" title="Create from Current Queue">➕ From Queue</button>
              <button id="refresh-playlists-btn" title="Refresh">🔄</button>
            </div>
          </div>
          <div id="playlist-list" class="playlist-list"></div>
        `;

        // Find a good place to insert the UI
        const nav = document.querySelector('ytmusic-nav-bar');
        if (nav && nav.parentElement) {
          nav.parentElement.insertBefore(container, nav.nextSibling);
        } else {
          document.body.appendChild(container);
        }

        // Set up event listeners
        document.getElementById('import-playlist-btn')?.addEventListener('click', importPlaylist);
        document.getElementById('create-playlist-btn')?.addEventListener('click', createFromQueue);
        document.getElementById('refresh-playlists-btn')?.addEventListener('click', loadPlaylists);

        // Load playlists
        loadPlaylists();
      };

      // Load and display playlists
      const loadPlaylists = async () => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const listContainer = document.getElementById('playlist-list');
        
        if (!listContainer) return;

        if (playlists.length === 0) {
          listContainer.innerHTML = '<div class="no-playlists">No local playlists yet. Create one from your current queue or import one!</div>';
          return;
        }

        listContainer.innerHTML = playlists.map((playlist: Playlist) => `
          <div class="playlist-item" data-playlist="${playlist.name}">
            <div class="playlist-info">
              <div class="playlist-name">${playlist.name}</div>
              <div class="playlist-meta">${playlist.songs.length} songs</div>
            </div>
            <div class="playlist-buttons">
              <button class="play-playlist-btn" data-playlist="${playlist.name}" title="Play">▶️</button>
              <button class="export-playlist-btn" data-playlist="${playlist.name}" title="Export">📤</button>
              <button class="delete-playlist-btn" data-playlist="${playlist.name}" title="Delete">🗑️</button>
            </div>
          </div>
        `).join('');

        // Add event listeners to playlist buttons
        listContainer.querySelectorAll('.play-playlist-btn').forEach(btn => {
          btn.addEventListener('click', (e) => playPlaylist((e.target as HTMLElement).dataset.playlist!));
        });
        
        listContainer.querySelectorAll('.export-playlist-btn').forEach(btn => {
          btn.addEventListener('click', (e) => exportPlaylist((e.target as HTMLElement).dataset.playlist!));
        });
        
        listContainer.querySelectorAll('.delete-playlist-btn').forEach(btn => {
          btn.addEventListener('click', (e) => deletePlaylist((e.target as HTMLElement).dataset.playlist!));
        });
      };

      // Create playlist from current queue
      const createFromQueue = async () => {
        const name = prompt('Enter playlist name:');
        if (!name) return;

        // Extract current queue information
        const songs: Song[] = [];
        
        // Try to get songs from the queue
        const queueItems = document.querySelectorAll('ytmusic-player-queue-item');
        queueItems.forEach(item => {
          const titleEl = item.querySelector('.title');
          const artistEl = item.querySelector('.byline');
          
          if (titleEl && artistEl) {
            songs.push({
              videoId: item.getAttribute('video-id') || '',
              title: titleEl.textContent?.trim() || '',
              artist: artistEl.textContent?.trim() || ''
            });
          }
        });

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
        if (result.success) {
          loadPlaylists();
        }
      };

      // Import playlist
      const importPlaylist = async () => {
        const result = await context.ipc.invoke('import-playlist-file');
        alert(result.message);
        if (result.success) {
          loadPlaylists();
        }
      };

      // Export playlist
      const exportPlaylist = async (playlistName: string) => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const playlist = playlists.find((p: Playlist) => p.name === playlistName);
        
        if (!playlist) {
          alert('Playlist not found');
          return;
        }

        const format = prompt('Export format? (json/txt/m3u)', 'json');
        if (!format || !['json', 'txt', 'm3u'].includes(format)) {
          return;
        }

        const result = await context.ipc.invoke('export-playlist-file', playlist, format);
        alert(result.message);
      };

      // Play playlist
      const playPlaylist = async (playlistName: string) => {
        const playlists = await context.ipc.invoke('get-local-playlists');
        const playlist = playlists.find((p: Playlist) => p.name === playlistName);
        
        if (!playlist || playlist.songs.length === 0) {
          alert('Playlist not found or empty');
          return;
        }

        // Play songs by searching for them
        for (const song of playlist.songs) {
          const searchQuery = song.videoId || `${song.artist} ${song.title}`;
          // Note: This requires navigating to search and playing - complex to automate
          // A full implementation would need to use YouTube Music's internal API
          console.log('Would play:', searchQuery);
        }

        alert(`Playlist loading feature coming soon! For now, manually search for songs from: ${playlist.songs[0].artist} - ${playlist.songs[0].title}`);
      };

      // Delete playlist
      const deletePlaylist = async (playlistName: string) => {
        if (!confirm(`Delete playlist "${playlistName}"?`)) {
          return;
        }

        const result = await context.ipc.invoke('delete-playlist', playlistName);
        alert(result.message);
        if (result.success) {
          loadPlaylists();
        }
      };

      // Wait for page to load, then create UI
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(createPlaylistUI, 1000);
        });
      } else {
        setTimeout(createPlaylistUI, 1000);
      }
    },

    onConfigChange(newConfig) {
      console.log('Renderer config changed:', newConfig);
    },

    stop() {
      const ui = document.getElementById('local-playlist-manager');
      if (ui) {
        ui.remove();
      }
    }
  }
});
