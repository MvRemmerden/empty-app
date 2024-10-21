/* eslint-env es2021 */
const { menubar } = require('menubar');
const { Menu, Notification, shell, ipcMain, dialog, app } = require('electron');
const { URL } = require('url');
const ua = require('universal-analytics');
const jsdom = require('jsdom');
const nodeCrypto = require('crypto');
const { escapeHtml, escapeQuotes, escapeSingleQuotes, sha256hex } = require('./lib/util');
const GitLab = require('./lib/gitlab');
const {
  chevronLgLeftIcon,
  chevronLgLeftIconWithViewboxHack,
  chevronLgRightIcon,
  chevronLgRightIconWithViewboxHack,
  chevronRightIcon,
  externalLinkIcon,
  projectIcon,
  removeIcon,
  todosAllDoneIllustration,
} = require('./src/icons');
const {
  allLabel,
  allText,
  approvalLabel,
  approvalText,
  approvedLabel,
  approvedText,
  assignedLabel,
  assignedText,
  closedLabel,
  closedText,
  createdLabel,
  createdText,
  dueDateLabel,
  dueDateText,
  mergedLabel,
  mergedText,
  openedLabel,
  openedText,
  query,
  recentlyCreatedLabel,
  recentlyCreatedText,
  recentlyUpdatedLabel,
  recentlyUpdatedText,
  reviewedLabel,
  reviewedText,
  sort,
  state,
} = require('./src/filter-text');
const { store, deleteFromStore } = require('./lib/store');
const BrowserHistory = require('./lib/browser-history');
const processInfo = require('./lib/process-info');
const { version } = require('./package.json');
const CommandPalette = require('./src/command-palette');
// eslint-disable-next-line no-shadow
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { JSDOM } = jsdom;
let commandPalette;
global.DOMParser = new JSDOM().window.DOMParser;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let visitor;
if (store.analytics) {
  visitor = ua('UA-203420427-1', store.analytics_id);
}
let recentlyVisitedString = '';
let currentProject;
let moreRecentlyVisitedArray = [];
let recentCommits = [];
let currentCommit;
let lastEventId;
let lastTodoId = -1;
let recentProjectCommits = [];
let currentProjectCommit;
const numberOfRecentlyVisited = 3;
const numberOfFavoriteProjects = 5;
const numberOfRecentComments = 3;
const numberOfIssues = 10;
const numberOfMRs = 10;
const numberOfTodos = 10;
const numberOfComments = 5;
let activeIssuesQueryOption = 'assigned_to_me';
let activeIssuesStateOption = 'opened';
let activeIssuesSortOption = 'created_at';
let activeMRsQueryOption = 'assigned_to_me';
let activeMRsStateOption = 'opened';
let activeMRsSortOption = 'created_at';
let runningPipelineSubscriptions = [];
let runningPipelineSubscriptionInterval = -1;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let isOnSubPage = false;

// Anti rebound variables
const delay = 2000;
let lastUserExecution = 0;
let lastRecentlyVisitedExecution = 0;
let lastLastCommitsExecution = 0;
let lastRecentCommentsExecution = 0;

let lastUserExecutionFinished = true;
let lastRecentlyVisitedExecutionFinished = true;
let lastLastCommitsExecutionFinished = true;
let lastRecentCommentsExecutionFinished = true;

let refreshInProgress = false;

let verifier = '';
let challenge = '';

const mb = menubar({
  showDockIcon: store.show_dock_icon,
  showOnAllWorkspaces: false,
  icon: `${__dirname}/assets/gitlabTemplate.png`,
  preloadWindow: true,
  browserWindow: {
    width: 550,
    height: 700,
    minWidth: 265,
    minHeight: 300,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      nodeIntegration: process.env.NODE_ENV === 'test',
      contextIsolation: process.env.NODE_ENV !== 'test',
      enableRemoteModule: process.env.NODE_ENV === 'test',
    },
    alwaysOnTop: store.keep_visible,
  },
});

const executeUnsafeJavaScript = (js) => mb.window.webContents.executeJavaScript(js);

const setElementHtml = (selector, html) =>
  // This is caused by a Pretter/eslint mismatch
  // eslint-disable-next-line implicit-arrow-linebreak
  executeUnsafeJavaScript(
    `document.querySelector("${escapeQuotes(selector)}").innerHTML = "${escapeQuotes(html).replace(
      /\n/g,
      '\\n',
    )}"`,
  );

// eslint-disable-next-line object-curly-newline
async function callApi(what, options = {}, host = store.host) {
  return new Promise((resolve, reject) => {
    GitLab.get(what, options, host)
      .then((result) => {
        if (result && result.error) {
          // eslint-disable-next-line no-use-before-define
          tryRefresh();
        }
        resolve(result);
      })
      .catch(() => {
        reject();
      });
  });
}

function openSettingsPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/settings').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'Settings');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  const lightString = "'light'";
  const darkString = "'dark'";
  setElementHtml('#detail-headline', '<span class="name">Theme</span>');
  let settingsString = '';
  const theme = `<div id="theme-selection"><div id="light-mode" class="theme-option" onclick="changeTheme(${lightString})"><div class="indicator"></div>Light</div><div id="dark-mode" class="theme-option" onclick="changeTheme(${darkString})"><div class="indicator"></div>Dark</div></div>`;
  if (store.user_id && store.username) {
    const projects = store['favorite-projects'];
    let favoriteProjects =
      '<div class="headline"><span class="name">Favorite projects</span></div><div id="favorite-projects"><ul class="list-container">';
    if (projects && projects.length > 0) {
      projects.forEach((project) => {
        favoriteProjects += `<li>${projectIcon}<div class="name-with-namespace"><span>${escapeHtml(
          project.name,
        )}</span><span class="namespace">${escapeHtml(project.namespace.name)}</span></div>`;
        favoriteProjects += `<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteProject(${project.id})">${removeIcon}</div></div></li>`;
      });
    }
    favoriteProjects += `<li id="add-project-dialog" class="more-link"><a onclick="startProjectDialog()">Add another project ${chevronRightIcon}</a></li></ul></div>`;
    let preferences =
      '<div class="headline"><span class="name">Preferences</span></div><div id="preferences"><form id="prerefences-form">';
    preferences += '<div><input type="checkbox" id="keep-visible" name="keep-visible" ';
    if (store.keep_visible) {
      preferences += ' checked="checked"';
    }
    preferences +=
      'onchange="changeKeepVisible(this.checked)"/><label for="keep-visible">Keep GitDock visible, even when losing focus.</label></div>';
    if (processInfo.platform === 'darwin') {
      preferences += '<div><input type="checkbox" id="show-dock-icon" name="show-dock-icon" ';
      if (store.show_dock_icon) {
        preferences += ' checked="checked"';
      }
      preferences +=
        'onchange="changeShowDockIcon(this.checked)"/><label for="show-dock-icon">Show icon also in dock, not only in menubar.</label></div>';
    }
    preferences += '</form></div>';
    let shortcut =
      '<div class="headline"><span class="name">Command Palette shortcuts</span></div><div id="shortcut"><p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p>';
    if (store.shortcuts) {
      shortcut += '<ul class="list-container">';
      store.shortcuts.forEach((keys) => {
        shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
      });
      shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
    }
    shortcut += '</div>';
    let analyticsString =
      '<div class="headline"><span class="name">Analytics</span></div><div id="analytics">';
    analyticsString +=
      'To better understand how you make use of GitDock features to navigate around your issues, MRs, and other areas, we would love to collect insights about your usage. All data is 100% anonymous and we do not track the specific content (projects, issues...) you are interacting with, only which kind of areas you are using.</div>';
    analyticsString += `<form id="analytics-form"><div><input type="radio" id="analytics-yes" name="analytics" value="yes"${
      store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(true)"><label for="analytics-yes">Yes, collect anonymous data.</label></div><div><input type="radio" id="analytics-no" name="analytics" value="no"${
      !store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(false)"><label for="analytics-no">No, do not collect any data.</label></div></form>`;
    const signout =
      '<div class="headline"><span class="name">User</span></div><div id="user-administration"><button id="logout-button" onclick="logout()">Log out</button></div>';
    settingsString = theme + favoriteProjects + preferences + shortcut + analyticsString + signout;
  } else {
    settingsString = theme;
  }
  setElementHtml('#detail-content', `${settingsString}</div>`);
  executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
  executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
  executeUnsafeJavaScript(`document.getElementById("${store.theme}-mode").classList.add("active")`);
}

function openAboutPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/about').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'About GitDock ⚓️');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  setElementHtml('#detail-headline', '<span class="name">About GitDock ⚓️</span>');
  let aboutString =
    '<p>GitDock is a MacOS/Windows/Linux app that displays all your GitLab activities in one place. Instead of the GitLab typical project- or group-centric approach, it collects all your information from a user-centric perspective.</p>';
  aboutString +=
    '<p>If you want to learn more about why we built this app, you can have a look at our <a href="https://about.gitlab.com/blog/2021/10/05/gitpod-desktop-app-personal-activities" target="_blank">blog post</a>.</p>';
  aboutString +=
    '<p>We use issues to collect bugs, feature requests, and more. You can <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues" target="_blank">browse through existing issues</a>. To report a bug, suggest an improvement, or propose a feature, please <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues/new">create a new issue</a> if there is not already an issue for it.</p>';
  aboutString +=
    '<p>If you are thinking about contributing directly, check out our <a href="https://gitlab.com/mvanremmerden/gitdock/-/blob/main/CONTRIBUTING.md" target="_blank">contribution guidelines</a>.</p>';
  aboutString += `<p class="version-number">Version ${version}</p>`;
  setElementHtml('#detail-content', `${aboutString}</div>`);
}

function setupLinuxContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GitDock',
      click: () => mb.showWindow(),
      visible: processInfo.platform === 'linux',
    },
    ...baseMenuItems,
  ]);

  mb.tray.setContextMenu(menu);
}

function setupGenericContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate(baseMenuItems);

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(menu);
  });
}

function setupContextMenu() {
  const baseMenuItems = [
    {
      label: 'Settings',
      click: () => {
        openSettingsPage();
      },
    },
    {
      label: 'About',
      click: () => {
        openAboutPage();
      },
    },
    {
      label: 'Quit',
      click: () => {
        mb.app.quit();
      },
    },
  ];

  if (processInfo.platform === 'linux') {
    setupLinuxContextMenu(baseMenuItems);
  } else {
    setupGenericContextMenu(baseMenuItems);
  }
}

function setupCommandPalette() {
  if (!commandPalette) {
    commandPalette = new CommandPalette();
  }

  commandPalette.register({
    shortcut: store.shortcuts,
  });
}

function chooseCertificate() {
  mb.window.setAlwaysOnTop(true);
  const filepaths = dialog.showOpenDialogSync();
  setTimeout(() => {
    mb.window.setAlwaysOnTop(false);
  }, 200);
  if (filepaths) {
    const filepath = filepaths[0].replace(/\\/g, '/'); // convert \ to / otherwise separators get lost on windows
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-button").classList.add("hidden")',
    );
    executeUnsafeJavaScript(
      `document.getElementById("custom-cert-path-text").innerText="${filepath}"`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-text").classList.remove("hidden")',
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-reset").classList.remove("hidden")',
    );
  }
}

function repaintShortcuts() {
  let shortcut =
    '<p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p><ul class="list-container">';
  if (store.shortcuts) {
    store.shortcuts.forEach((keys) => {
      shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
    });
    shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
  }
  shortcut += '</div>';
  setElementHtml('#shortcut', shortcut);
}

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function timeSince(date, direction = 'since') {
  let seconds;
  if (direction === 'since') {
    seconds = Math.floor((new Date() - date) / 1000);
  } else if (direction === 'to') {
    seconds = Math.floor((date - new Date()) / 1000);
  }
  let interval = seconds / 31536000;
  if (interval >= 2) {
    return `${Math.floor(interval)} years`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} year`;
  }
  interval = seconds / 2592000;
  if (interval > 2) {
    return `${Math.floor(interval)} months`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} month`;
  }
  interval = seconds / 604800;
  if (interval > 2) {
    return `${Math.floor(interval)} weeks`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} week`;
  }
  interval = seconds / 86400;
  if (interval > 2) {
    return `${Math.floor(interval)} days`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} day`;
  }
  interval = seconds / 3600;
  if (interval >= 2) {
    return `${Math.floor(interval)} hours`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} hour`;
  }
  interval = seconds / 60;
  if (interval > 2) {
    return `${Math.floor(interval)} minutes`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} minute`;
  }
  return `${Math.floor(seconds)} seconds`;
}

function logout() {
  deleteFromStore('user_id');
  deleteFromStore('username');
  deleteFromStore('access_token');
  deleteFromStore('custom_cert_path');
  deleteFromStore('host');
  deleteFromStore('plan');
  mb.window.webContents.session.clearCache();
  mb.window.webContents.session.clearStorageData();
  app.quit();
  app.relaunch();
}

function displayUsersProjects() {
  let favoriteProjectsHtml = '';
  const projects = store['favorite-projects'];
  if (projects && projects.length > 0) {
    favoriteProjectsHtml += '<ul class="list-container clickable" data-testid="favorite-projects">';
    const chevron = chevronLgRightIcon;
    projects.forEach((projectObject) => {
      const projectString = "'Project'";
      const jsonProjectObject = JSON.parse(JSON.stringify(projectObject));
      jsonProjectObject.name_with_namespace = projectObject.name_with_namespace;
      jsonProjectObject.namespace.name = projectObject.namespace.name;
      jsonProjectObject.name = projectObject.name;
      const projectJson = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
      favoriteProjectsHtml += `<li onclick="goToDetail(${projectString}, ${projectJson})">${projectIcon}`;
      favoriteProjectsHtml += `<div class="name-with-namespace"><span>${escapeHtml(
        projectObject.name,
      )}</span><span class="namespace">${escapeHtml(
        projectObject.namespace.name,
      )}</span></div><div class="chevron-right-wrapper">${chevron}</div></li>`;
    });
    favoriteProjectsHtml += '</ul>';
  } else {
    const projectLink = "'project-overview-link'";
    favoriteProjectsHtml = `<div class="new-project"><div><span class="cta">Track projects you care about</span> 🌟</div><div class="cta-description">Add any project you want a directly accessible shortcut for.</div><form class="project-input" action="#" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-overview-link" placeholder="Enter the project link here..." /><button class="add-button" id="project-overview-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-overview-error"></div></div>`;
  }
  setElementHtml('#projects', favoriteProjectsHtml);
}

async function getUsersProjects() {
  const projects = await callApi(`users/${store.user_id}/starred_projects`, {
    min_access_level: 30,
    per_page: numberOfFavoriteProjects,
    order_by: 'updated_at',
  });
  if (projects) {
    return projects.map((project) => ({
      id: project.id,
      visibility: project.visibility,
      web_url: project.web_url,
      name: project.name,
      namespace: {
        name: project.namespace.name,
      },
      added: Date.now(),
      name_with_namespace: project.name_with_namespace,
      open_issues_count: project.open_issues_count,
      last_activity_at: project.last_activity_at,
      avatar_url: project.avatar_url,
      star_count: project.star_count,
      forks_count: project.forks_count,
    }));
  }
  return false;
}

function getBookmarks() {
  const { bookmarks } = store;
  let bookmarksString = '';
  if (bookmarks && bookmarks.length > 0) {
    bookmarksString = '<ul class="list-container">';
    bookmarks.forEach((bookmark) => {
      let namespaceLink = '';
      if (bookmark.parent_name && bookmark.parent_url) {
        namespaceLink = ` &middot; <a href="${bookmark.parent_url}" target="_blank">${escapeHtml(
          bookmark.parent_name,
        )}</a>`;
      }

      let { title } = bookmark;

      if (bookmark.id && ['merge_requests', 'issues'].includes(bookmark.type)) {
        const typeIndicator = GitLab.indicatorForType(bookmark.type);
        title += ` (${typeIndicator}${bookmark.id})`;
      }

      bookmarksString += `<li class="history-entry bookmark-entry"><div class="bookmark-information"><a href="${escapeSingleQuotes(
        escapeHtml(bookmark.web_url),
      )}" id="bookmark-title" target="_blank">${escapeHtml(
        title,
      )}</a><span class="namespace-with-time">Added ${timeSince(
        bookmark.added,
      )} ago${namespaceLink}</span></div><div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteBookmark('${sha256hex(
        bookmark.web_url,
      )}')">${removeIcon}</div></div></li>`;
    });
    bookmarksString += `<li id="add-bookmark-dialog" class="more-link"><a onclick="startBookmarkDialog()">Add another bookmark ${chevronRightIcon}</a></li></ul>`;
  } else {
    const bookmarkLink = "'bookmark-link'";
    bookmarksString = `<div id="new-bookmark"><div><span class="cta">Add a new GitLab bookmark</span> 🔖</div><div class="cta-description">Bookmarks are helpful when you have an issue/merge request you will have to come back to repeatedly.</div><form id="bookmark-input" action="#" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter the link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div></div>`;
  }
  setElementHtml('#bookmarks', bookmarksString);
}

async function getRecentlyVisited() {
  if (lastRecentlyVisitedExecutionFinished && lastRecentlyVisitedExecution + delay < Date.now()) {
    lastRecentlyVisitedExecutionFinished = false;
    const recentlyVisitedArray = [];
    recentlyVisitedString = '';
    let firstItem = true;
    await BrowserHistory.getAllHistory().then(async (history) => {
      const item = Array.prototype.concat.apply([], history);
      item.sort((a, b) => {
        if (a.utc_time > b.utc_time) {
          return -1;
        }
        if (b.utc_time > a.utc_time) {
          return 1;
        }
        return -1;
      });
      let i = 0;
      for (let j = 0; j < item.length; j += 1) {
        if (
          item[j].title &&
          item[j].url.indexOf(`${store.host}/`) === 0 &&
          (item[j].url.indexOf('/-/issues/') !== -1 ||
            item[j].url.indexOf('/-/merge_requests/') !== -1 ||
            item[j].url.indexOf('/-/epics/') !== -1) &&
          !recentlyVisitedArray.includes(item[j].title) &&
          item[j].title.split('·')[0] !== 'Not Found' &&
          item[j].title.split('·')[0] !== 'New Issue ' &&
          item[j].title.split('·')[0] !== 'New Merge Request ' &&
          item[j].title.split('·')[0] !== 'New merge request ' &&
          item[j].title.split('·')[0] !== 'New Epic ' &&
          item[j].title.split('·')[0] !== 'Edit ' &&
          item[j].title.split('·')[0] !== 'Merge requests ' &&
          item[j].title.split('·')[0] !== 'Issues '
        ) {
          if (firstItem) {
            recentlyVisitedString = '<ul class="list-container">';
            firstItem = false;
          }
          const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
          if (nameWithNamespace.split('/')[0] !== 'groups') {
            item.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
              nameWithNamespace.split('/')[1]
            }?access_token=${store.access_token}`;
          } else {
            item.url = `${store.host}/api/v4/groups/${
              nameWithNamespace.split('/')[0]
            }?access_token=${store.access_token}`;
          }
          recentlyVisitedArray.push(item[j].title);
          if (item[j].title !== 'Checking your Browser - GitLab') {
            recentlyVisitedString += '<li class="history-entry">';
            recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
              item[j].title.split('·')[0],
            )}</a><span class="namespace-with-time">${timeSince(
              new Date(`${item[j].utc_time} UTC`),
            )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
              item[j].title.split('·')[2].trim(),
            )}</a></span></div></li>`;
            i += 1;
            if (i === numberOfRecentlyVisited) {
              break;
            }
          }
        }
      }
      if (!firstItem) {
        const moreString = "'Recently viewed'";
        recentlyVisitedString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
      } else if (BrowserHistory.isSupported()) {
        recentlyVisitedString = `<p class="no-results">Recently visited objects will show up here.<br/><span class="supported-browsers">Supported browsers: ${BrowserHistory.supportedBrowserNames()}.</span></p>`;
      } else {
        recentlyVisitedString =
          '<p class="no-results"><span class="supported-browsers">No browsers are supported on your operating system yet.</span></p>';
      }
      setElementHtml('#history', recentlyVisitedString);
      lastRecentlyVisitedExecution = Date.now();
      lastRecentlyVisitedExecutionFinished = true;
    });
  }
}

async function subscribeToRunningPipeline() {
  if (runningPipelineSubscriptionInterval !== -1) {
    clearInterval(runningPipelineSubscriptionInterval);
  }
  runningPipelineSubscriptionInterval = setInterval(async () => {
    runningPipelineSubscriptions.forEach(async (runningPipeline) => {
      const pipeline = await callApi(
        `projects/${runningPipeline.project_id}/pipelines/${runningPipeline.id}`,
      );
      if (pipeline) {
        let pipelineStatus;
        if (pipeline.status !== 'running') {
          if (pipeline.status === 'success') {
            pipelineStatus = 'succeeded';
          } else {
            pipelineStatus = pipeline.status;
          }
          const updateNotification = new Notification({
            title: `Pipeline ${pipelineStatus}`,
            subtitle: GitLab.fetchUrlInfo(pipeline.web_url).namespaceWithProject,
            body: runningPipeline.commit_title,
          });
          updateNotification.on('click', () => {
            shell.openExternal(pipeline.web_url);
          });
          updateNotification.show();
          runningPipelineSubscriptions = runningPipelineSubscriptions.filter(
            (subscriptionPipeline) => subscriptionPipeline.id !== pipeline.id,
          );
          if (runningPipelineSubscriptions.length === 0) {
            clearInterval(runningPipelineSubscriptionInterval);
            runningPipelineSubscriptionInterval = -1;
            mb.tray.setImage(`${__dirname}/assets/gitlabTemplate.png`);
          }
        }
      }
    });
  }, 10000);
}

async function getLastPipelines(commits) {
  const projectArray = [];
  if (commits && commits.length > 0) {
    commits.forEach(async (commit) => {
      if (!projectArray.includes(commit.project_id)) {
        projectArray.push(commit.project_id);
        const pipelines = await callApi(`projects/${commit.project_id}/pipelines`, {
          status: 'running',
          username: store.username,
          per_page: 1,
          page: 1,
        });
        if (pipelines && pipelines.length > 0) {
          mb.tray.setImage(`${__dirname}/assets/runningTemplate.png`);
          pipelines.forEach(async (pipeline) => {
            const commitPipeline = pipeline;
            if (
              runningPipelineSubscriptions.findIndex(
                (subscriptionPipeline) => subscriptionPipeline.id === pipeline.id,
              ) === -1
            ) {
              const pipelineCommit = await callApi(
                `projects/${pipeline.project_id}/repository/commits/${pipeline.sha}`,
              );
              if (pipelineCommit) {
                commitPipeline.commit_title = pipelineCommit.title;
                runningPipelineSubscriptions.push(commitPipeline);
                const runningNotification = new Notification({
                  title: 'Pipeline running',
                  subtitle: GitLab.fetchUrlInfo(commitPipeline.web_url).namespaceWithProject,
                  body: commitPipeline.commit_title,
                });
                runningNotification.on('click', () => {
                  shell.openExternal(commitPipeline.web_url);
                });
                runningNotification.show();
              }
            }
          });
          subscribeToRunningPipeline();
        }
      }
    });
  }
}

function displayAddError(type, target, customMessage) {
  executeUnsafeJavaScript(
    `document.getElementById("add-${type}${target}error").style.display = "block"`,
  );
  if (customMessage) {
    setElementHtml(`#add-${type}${target}error`, customMessage);
  } else {
    setElementHtml(`#add-${type}${target}error`, `This is not a valid GitLab ${type} URL.`);
  }
  executeUnsafeJavaScript(`document.getElementById("${type}${target}add-button").disabled = false`);
  executeUnsafeJavaScript(`document.getElementById("${type}${target}link").disabled = false`);
  setElementHtml(`#${type}${target}add-button`, 'Add');
}

function displayPagination(keysetLinks, type) {
  let paginationString = '';
  if (keysetLinks.indexOf('rel="next"') !== -1 || keysetLinks.indexOf('rel="prev"') !== -1) {
    paginationString += '<div id="pagination">';
    if (keysetLinks.indexOf('rel="prev"') !== -1) {
      let prevLink = '';
      prevLink = escapeHtml(`"${keysetLinks.split('>; rel="prev"')[0].substring(1)}"`);
      paginationString += `<button onclick="switchPage(${prevLink}, ${type})" class="prev">${chevronLgLeftIcon} Previous</button>`;
    } else {
      paginationString += '<div></div>';
    }
    if (keysetLinks.indexOf('rel="next"') !== -1) {
      let nextLink = '';
      if (keysetLinks.indexOf('rel="prev"') !== -1) {
        nextLink = escapeHtml(
          `"${keysetLinks.split('rel="prev", ')[1].split('>; rel="next"')[0].substring(1)}"`,
        );
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      } else {
        nextLink = escapeHtml(`"${keysetLinks.split('>; rel="next"')[0].substring(1)}"`);
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      }
    } else {
      paginationString += '<div></div>';
    }
    paginationString += '</div>';
  }
  return paginationString;
}

function renderCollabject(comment, collabject) {
  const collabObject = collabject;
  if (collabObject.message && collabObject.message === '404 Not found') {
    return 0;
  }
  if (comment.note.noteable_type === 'DesignManagement::Design') {
    collabObject.web_url += `/designs/${comment.target_title}`;
    return `<li class="comment"><a href="${collabObject.web_url}#note_${
      comment.note.id
    }" target="_blank">${escapeHtml(
      comment.note.body,
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(comment.created_at),
    )} ago &middot; <a href="${
      collabObject.web_url.split('#note')[0]
    }" target="_blank">${escapeHtml(comment.target_title)}</a></span></div></li>`;
  }
  return `<li class="comment"><a href="${collabObject.web_url}#note_${
    comment.note.id
  }" target="_blank">${escapeHtml(
    comment.note.body,
  )}</a><span class="namespace-with-time">${timeSince(
    new Date(comment.created_at),
  )} ago &middot; <a href="${collabObject.web_url.split('#note')[0]}" target="_blank">${escapeHtml(
    comment.target_title,
  )}</a></span></div></li>`;
}

function displayCommit(commit, project, focus = 'project') {
  let logo = '';
  if (commit.last_pipeline) {
    logo += `<a target="_blank" href="${commit.last_pipeline.web_url}" class="pipeline-link">`;
    if (commit.last_pipeline.status === 'scheduled') {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7"/><circle class="icon" style="fill: var(--svg-status-bg, #c9d1d9);" cx="7" cy="7" r="6"/><g transform="translate(2.75 2.75)" fill-rule="nonzero"><path d="M4.165 7.81a3.644 3.644 0 1 1 0-7.29 3.644 3.644 0 0 1 0 7.29zm0-1.042a2.603 2.603 0 1 0 0-5.206 2.603 2.603 0 0 0 0 5.206z"/><rect x="3.644" y="2.083" width="1.041" height="2.603" rx=".488"/><rect x="3.644" y="3.644" width="2.083" height="1.041" rx=".488"/></g></svg>';
    } else {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="M0 7a7 7 0 1 1 14 0A7 7 0 0 1 0 7z" class="icon"/><path d="M13 7A6 6 0 1 0 1 7a6 6 0 0 0 12 0z" class="icon-inverse" />';
      if (commit.last_pipeline.status === 'running') {
        logo +=
          '<path d="M7 3c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.3 0-2.5-.7-3.3-1.7L7 7V3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'failed') {
        logo +=
          '<path d="M7 5.969L5.599 4.568a.29.29 0 0 0-.413.004l-.614.614a.294.294 0 0 0-.004.413L5.968 7l-1.4 1.401a.29.29 0 0 0 .004.413l.614.614c.113.114.3.117.413.004L7 8.032l1.401 1.4a.29.29 0 0 0 .413-.004l.614-.614a.294.294 0 0 0 .004-.413L8.032 7l1.4-1.401a.29.29 0 0 0-.004-.413l-.614-.614a.294.294 0 0 0-.413-.004L7 5.968z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'success') {
        logo +=
          '<path d="M6.278 7.697L5.045 6.464a.296.296 0 0 0-.42-.002l-.613.614a.298.298 0 0 0 .002.42l1.91 1.909a.5.5 0 0 0 .703.005l.265-.265L9.997 6.04a.291.291 0 0 0-.009-.408l-.614-.614a.29.29 0 0 0-.408-.009L6.278 7.697z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'pending') {
        logo +=
          '<path d="M4.7 5.3c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H5c-.2 0-.3-.1-.3-.3V5.3m3 0c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H8c-.2 0-.3-.1-.3-.3V5.3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'canceled') {
        logo +=
          '<path d="M5.2 3.8l4.9 4.9c.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0L3.8 5.2c-.2-.2-.2-.5 0-.7l.7-.7c.2-.2.5-.2.7 0" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'skipped') {
        logo +=
          '<path d="M6.415 7.04L4.579 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L5.341 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L6.415 7.04zm2.54 0L7.119 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L7.881 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L8.955 7.04z" class="icon"/></svg>';
      } else if (commit.last_pipeline.status === 'created') {
        logo += '<circle cx="7" cy="7" r="3.25" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'preparing') {
        logo +=
          '</g><circle cx="7" cy="7" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="4" cy="7" r="1"/></g></svg>';
      } else if (commit.last_pipeline.status === 'manual') {
        logo +=
          '<path d="M10.5 7.63V6.37l-.787-.13c-.044-.175-.132-.349-.263-.61l.481-.652-.918-.913-.657.478a2.346 2.346 0 0 0-.612-.26L7.656 3.5H6.388l-.132.783c-.219.043-.394.13-.612.26l-.657-.478-.918.913.437.652c-.131.218-.175.392-.262.61l-.744.086v1.261l.787.13c.044.218.132.392.263.61l-.438.651.92.913.655-.434c.175.086.394.173.613.26l.131.783h1.313l.131-.783c.219-.043.394-.13.613-.26l.656.478.918-.913-.48-.652c.13-.218.218-.435.262-.61l.656-.13zM7 8.283a1.285 1.285 0 0 1-1.313-1.305c0-.739.57-1.304 1.313-1.304.744 0 1.313.565 1.313 1.304 0 .74-.57 1.305-1.313 1.305z" class="icon"/></g></svg>';
      }
    }
  }
  logo += '</a>';
  let subline;
  if (focus === 'project') {
    subline = `<a href="${project.web_url}" target=_blank">${escapeHtml(
      project.name_with_namespace,
    )}</a>`;
  } else {
    subline = escapeHtml(commit.author_name);
  }
  return `<div class="commit"><div class="commit-information"><a href="${
    commit.web_url
  }" target="_blank">${escapeHtml(commit.title)}</a><span class="namespace-with-time">${timeSince(
    new Date(commit.committed_date),
  )} ago &middot; ${subline}</span></div>${logo}</div>`;
}

function renderNoCommitsPushedYetMessage() {
  executeUnsafeJavaScript('document.getElementById("commits-pagination").classList.add("hidden")');
  setElementHtml('#pipeline', '<p class="no-results">You haven&#039;t pushed any commits yet.</p>');
}

async function getCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("commits-pagination").classList.remove("hidden")',
  );
  executeUnsafeJavaScript('document.getElementById("commits-count").classList.remove("empty")');
  setElementHtml('#commits-count', `${index}/${recentCommits.length}`);
  const project = await callApi(`projects/${projectId}`);
  const commit = await callApi(`projects/${project.id}/repository/commits/${sha}`);
  if (project && commit) {
    setElementHtml('#pipeline', displayCommit(commit, project));
  }
}

async function getLastCommits(count = 20) {
  if (lastLastCommitsExecutionFinished && lastLastCommitsExecution + delay < Date.now()) {
    lastLastCommitsExecutionFinished = false;

    const commits = await callApi('events', {
      action: 'pushed',
      per_page: count,
    });
    if (commits && Array.isArray(commits) && !commits.error) {
      if (commits && commits.length > 0) {
        lastEventId = commits[0].id;
        getLastPipelines(commits);
        const committedArray = commits.filter(
          /* eslint-disable implicit-arrow-linebreak */
          (commit) =>
            commit.action_name === 'pushed to' ||
            (commit.action_name === 'pushed new' &&
              commit.push_data.commit_to &&
              commit.push_data.commit_count > 0),
          /* eslint-enable */
        );
        if (committedArray && committedArray.length > 0) {
          [currentCommit] = committedArray;
          recentCommits = committedArray;
          getCommitDetails(committedArray[0].project_id, committedArray[0].push_data.commit_to, 1);
        } else {
          renderNoCommitsPushedYetMessage();
        }
      } else {
        renderNoCommitsPushedYetMessage();
      }
    }
    lastLastCommitsExecution = Date.now();
    lastLastCommitsExecutionFinished = true;
  }
}

async function getRecentComments() {
  if (lastRecentCommentsExecutionFinished && lastRecentCommentsExecution + delay < Date.now()) {
    lastRecentCommentsExecutionFinished = false;
    let recentCommentsString = '';

    const comments = await callApi('events', {
      action: 'commented',
      per_page: numberOfRecentComments,
    });
    if (comments && Array.isArray(comments) && !comments.error) {
      if (comments && comments.length > 0) {
        recentCommentsString += '<ul class="list-container">';
        /* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop */
        for (const comment of comments) {
          const path = GitLab.commentToNoteableUrl(comment);

          if (!path) {
            continue;
          }

          const collabject = await callApi(path);
          if (collabject) {
            recentCommentsString += renderCollabject(comment, collabject);
          }
        }
        // eslint-disable no-restricted-syntax */
        const moreString = "'Comments'";
        recentCommentsString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
        setElementHtml('#comments', recentCommentsString);
      } else {
        setElementHtml(
          '#comments',
          '<p class="no-results">You haven&#039;t written any comments yet.</p>',
        );
      }
    }
    lastRecentCommentsExecution = Date.now();
    lastRecentCommentsExecutionFinished = true;
  }
}

async function getLastEvent() {
  if (!recentCommits || recentCommits.length === 0) {
    return;
  }
  const lastEvent = await callApi('events', {
    action: 'pushed',
    per_page: 1,
  });
  if (lastEvent && lastEvent.id !== lastEventId) {
    lastEventId = lastEvent.id;
    getLastCommits();
    getRecentComments();
  }
}

async function getLastTodo() {
  const todo = await callApi('todos', {
    per_page: 1,
  });
  if (todo && lastTodoId !== todo.id) {
    if (lastTodoId !== -1 && Date.parse(todo.created_at) > Date.now() - 20000) {
      const todoNotification = new Notification({
        title: todo.body,
        subtitle: todo.author.name,
        body: todo.target.title,
      });
      todoNotification.on('click', () => {
        shell.openExternal(todo.target_url);
      });
      todoNotification.show();
    }
    lastTodoId = todo.id;
  }
}

async function getUser() {
  if (lastUserExecutionFinished && lastUserExecution + delay < Date.now()) {
    lastUserExecutionFinished = false;

    const user = await callApi('user');
    if (user && !user.error) {
      let avatarUrl;
      if (user.avatar_url) {
        avatarUrl = new URL(user.avatar_url);
        if (avatarUrl.host !== 'secure.gravatar.com') {
          avatarUrl.href += '?width=64';
        }
      }
      const userHtml = `<a href="${user.web_url}" target="_blank"><img src="${
        avatarUrl.href
      }" /><div class="user-information"><span class="user-name">${escapeHtml(
        user.name,
      )}</span><span class="username">@${escapeHtml(user.username)}</span></div></a>`;
      setElementHtml('#user', userHtml);
      lastUserExecution = Date.now();
      lastUserExecutionFinished = true;
    }
  }
}

function tryRefresh() {
  if (!refreshInProgress) {
    refreshInProgress = true;
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        refresh_token: store.refresh_token,
        grant_type: 'refresh_token',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        if (result.access_token && result.refresh_token) {
          store.access_token = result.access_token;
          store.refresh_token = result.refresh_token;
          lastUserExecution = 0;
          lastLastCommitsExecution = 0;
          lastRecentCommentsExecution = 0;

          lastUserExecutionFinished = true;
          lastLastCommitsExecutionFinished = true;
          lastRecentCommentsExecutionFinished = true;

          getUser();
          getLastTodo();
          getLastCommits();
          getRecentComments();
        } else {
          logout();
        }
        refreshInProgress = false;
      })
      .catch(() => {
        refreshInProgress = false;
        logout();
      });
  }
}

async function saveUser(
  accessToken,
  url = store.host,
  customCertPath = undefined,
  refreshToken = undefined,
) {
  try {
    if (url.endsWith('/')) {
      /* eslint-disable no-param-reassign */
      url = url.substring(0, url.length - 1);
    }
    /* eslint-disable operator-linebreak, object-curly-newline */
    const options = customCertPath
      ? { access_token: accessToken, custom_cert_path: customCertPath }
      : { access_token: accessToken };
    /* eslint-enable */
    const result = await callApi('user', options, url);
    if (result && result.id && result.username) {
      store.access_token = accessToken;
      store.user_id = result.id;
      store.username = result.username;
      store.host = url;
      if (refreshToken) {
        store.refresh_token = refreshToken;
      }
      if (customCertPath) {
        store.custom_cert_path = customCertPath;
      }
      getUsersProjects().then(async (projects) => {
        if (
          store['favorite-projects'] &&
          store['favorite-projects'].length === 0 &&
          projects &&
          projects.length > 0
        ) {
          store['favorite-projects'] = projects;
        }
        // eslint-disable-next-line no-use-before-define
        mb.window.removeListener('page-title-updated', handleLogin);
        await mb.window
          .loadURL(`file://${__dirname}/index.html`)
          .then(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          })
          .catch(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          });
      });
    }
  } catch (e) {
    throw new Error(e);
  }
}

function handleLogin() {
  if (mb.window.webContents.getURL().indexOf('?code=') !== -1) {
    const code = mb.window.webContents.getURL().split('?code=')[1].replace('&state=test', '');
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
        code_verifier: verifier,
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        saveUser(result.access_token, 'https://gitlab.com', undefined, result.refresh_token);
      });
  }
}

async function startLogin() {
  verifier = base64URLEncode(nodeCrypto.randomBytes(32));
  challenge = base64URLEncode(sha256(verifier));
  await mb.window.loadURL(
    `${store.host}/oauth/authorize?client_id=2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee&redirect_uri=https://mvanremmerden.gitlab.io/gitdock-login/&response_type=code&state=test&scope=read_api&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  mb.window.on('page-title-updated', handleLogin);
  mb.showWindow();
}

async function getUsersPlan() {
  let userNamespace;
  const namespaces = await callApi('namespaces');
  if (namespaces && namespaces.length > 0) {
    userNamespace = namespaces.find((namespace) => namespace.kind === 'user');
  }

  store.plan = userNamespace && userNamespace.plan ? userNamespace.plan : 'free';
}

async function getProjectCommits(project, count = 20) {
  const commits = await callApi(`projects/${project.id}/repository/commits`, {
    per_page: count,
  });
  if (commits && commits.length > 0) {
    recentProjectCommits = commits;
    [currentProjectCommit] = commits;

    const commit = await callApi(`projects/${project.id}/repository/commits/${commits[0].id}`, {
      per_page: count,
    });
    if (commit) {
      const pagination = `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="project-commits-count">1/${recentProjectCommits.length}</span><button onclick="changeProjectCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeProjectCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`;
      setElementHtml('#detail-headline', pagination);
      setElementHtml('#project-pipeline', displayCommit(commit, project, 'author'));
    }
  } else {
    setElementHtml('#project-commits-pagination', '<span class="name">Commits</span>');
    setElementHtml('#project-pipeline', '<p class="no-results">No commits pushed yet.</p>');
  }
}

function changeCommit(forward, commitArray, chosenCommit) {
  let nextCommit;
  let index = commitArray.findIndex((commit) => commit.id === chosenCommit.id);
  if (forward) {
    if (index === commitArray.length - 1) {
      [nextCommit] = commitArray;
      index = 1;
    } else {
      nextCommit = commitArray[index + 1];
      index += 2;
    }
  } else if (index === 0) {
    nextCommit = commitArray[commitArray.length - 1];
    index = commitArray.length;
  } else {
    nextCommit = commitArray[index - 1];
  }
  nextCommit.index = index;
  return nextCommit;
}

async function getProjectCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("project-commits-count").classList.remove("empty")',
  );
  setElementHtml('#project-commits-count', `${index}/${recentProjectCommits.length}`);

  const commit = await callApi(`projects/${projectId}/repository/commits/${sha}`);
  if (commit) {
    setElementHtml('#project-pipeline', displayCommit(commit, currentProject, 'author'));
  }
}

async function getMoreRecentlyVisited() {
  recentlyVisitedString = '';
  let firstItem = true;
  await BrowserHistory.getAllHistory().then(async (history) => {
    const item = Array.prototype.concat.apply([], history);
    item.sort((a, b) => {
      if (a.utc_time > b.utc_time) {
        return -1;
      }
      if (b.utc_time > a.utc_time) {
        return 1;
      }
      return -1;
    });
    setElementHtml(
      '#detail-headline',
      '<input id="recentSearch" type="text" onkeyup="searchRecent(this)" placeholder="Search..." />',
    );

    let previousDate = 0;
    for (let j = 0; j < item.length; j += 1) {
      const { title } = item[j];
      let { url } = item[j];
      const isHostUrl = url.startsWith(`${store.host}/`);
      const isIssuable =
        url.includes('/-/issues/') ||
        url.includes('/-/merge_requests/') ||
        url.includes('/-/epics/');
      const wasNotProcessed = !moreRecentlyVisitedArray.some((object) => object.title === title);
      const ignoredTitlePrefixes = [
        'Not Found',
        'New Issue',
        'New Merge Request',
        'New merge request',
        'New Epic',
        'Edit',
        'Merge Conflicts',
        'Merge requests',
        'Issues',
        '500 Error - GitLab',
        'Checking your Browser - GitLab',
      ];
      const titlePrefix = (title || '').split('·')[0].trim();
      if (
        title &&
        isHostUrl &&
        isIssuable &&
        wasNotProcessed &&
        !ignoredTitlePrefixes.includes(titlePrefix)
      ) {
        const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
        if (nameWithNamespace.split('/')[0] !== 'groups') {
          url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
            nameWithNamespace.split('/')[1]
          }?access_token=${store.access_token}`;
        } else {
          url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
            store.access_token
          }`;
        }
        const currentDate = new Date(item[j].utc_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: timezone,
        });
        if (previousDate !== currentDate) {
          if (
            currentDate ===
            new Date(Date.now()).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              timeZone: timezone,
            })
          ) {
            recentlyVisitedString += '<div class="date">Today</div>';
          } else {
            if (!firstItem) {
              recentlyVisitedString += '</ul>';
            }
            recentlyVisitedString += `<div class="date">${currentDate}</div>`;
          }
          recentlyVisitedString += '<ul class="list-container history-list-container">';
          previousDate = currentDate;
        }
        moreRecentlyVisitedArray.push(item[j]);
        recentlyVisitedString += '<li class="history-entry">';
        recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
          item[j].title.split('·')[0],
        )}</a><span class="namespace-with-time">${timeSince(
          new Date(`${item[j].utc_time} UTC`),
        )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
          item[j].title.split('·')[2].trim(),
        )}</a></span></div></li>`;
        firstItem = false;
      }
    }
    recentlyVisitedString += '</ul>';
    setElementHtml('#detail-content', recentlyVisitedString);
  });
}

function searchRecentlyVisited(searchterm) {
  /* eslint-disable implicit-arrow-linebreak, function-paren-newline */
  const foundArray = moreRecentlyVisitedArray.filter((item) =>
    item.title.toLowerCase().includes(searchterm),
  );
  /* eslint-enable */
  let foundString = '<ul class="list-container">';
  foundArray.forEach((item) => {
    const object = item;
    const nameWithNamespace = object.url.replace(`${store.host}/`, '').split('/-/')[0];
    if (nameWithNamespace.split('/')[0] !== 'groups') {
      object.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
        nameWithNamespace.split('/')[1]
      }?access_token=${store.access_token}`;
    } else {
      object.url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
        store.access_token
      }`;
    }
    foundString += '<li class="history-entry">';
    foundString += `<a href="${object.url}" target="_blank">${escapeHtml(
      object.title.split('·')[0],
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(`${object.utc_time} UTC`),
    )} ago &middot; <a href="${object.url.split('/-/')[0]}" target="_blank">${escapeHtml(
      object.title.split('·')[2].trim(),
    )}</a></span></div></li>`;
  });
  foundString += '</ul>';
  setElementHtml('#detail-content', foundString);
}

function getMoreRecentComments(
  url = `${store.host}/api/v4/events?action=commented&per_page=${numberOfComments}&access_token=${store.access_token}`,
) {
  let recentCommentsString = '<ul class="list-container">';
  const type = "'Comments'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then(async (comments) => {
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const comment of comments) {
        const path = GitLab.commentToNoteableUrl(comment);
        const collabject = await callApi(path);
        if (collabject) {
          recentCommentsString += renderCollabject(comment, collabject);
        }
      }
      /* eslint-enable */
      recentCommentsString += `</ul>${displayPagination(keysetLinks, type)}`;
      setElementHtml('#detail-content', recentCommentsString);
    });
}

function getIssues(
  url = `${store.host}/api/v4/issues?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let issuesString = '';
  const type = "'Issues'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((issues) => {
      if (issues && issues.length > 0) {
        issuesString += '<ul class="list-container">';
        issues.forEach((issue) => {
          let timestamp;
          if (activeIssuesSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(issue.updated_at))} ago`;
          } else if (activeIssuesSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(issue.created_at))} ago`;
          } else if (activeIssuesSortOption === 'due_date&sort=asc') {
            if (!issue.due_date) {
              timestamp = 'No due date';
            } else if (new Date() > new Date(issue.due_date)) {
              timestamp = `Due ${timeSince(new Date(issue.due_date))} ago`;
            } else {
              timestamp = `Due in ${timeSince(new Date(issue.due_date), 'to')}`;
            }
          }
          issuesString += '<li class="history-entry">';
          issuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
            issue.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            issue.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(
            issue.references.full.split('#')[0],
          )}</a></span></div></li>`;
        });
        issuesString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        issuesString = `<div class="zero">${illustration}<p>No issues with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, issuesString);
    });
}

function getMRs(
  url = `${store.host}/api/v4/merge_requests?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let mrsString = '';
  const type = "'MRs'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((mrs) => {
      if (mrs && mrs.length > 0) {
        mrsString = '<ul class="list-container">';
        mrs.forEach((mr) => {
          let timestamp;
          if (activeMRsSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(mr.updated_at))} ago`;
          } else if (activeMRsSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(mr.created_at))} ago`;
          }
          mrsString += '<li class="history-entry">';
          mrsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
            mr.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            mr.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(mr.references.full.split('!')[0])}</a></span></div></li>`;
        });
        mrsString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        mrsString = `<div class="zero">${illustration}<p>No merge requests with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, mrsString);
    });
}

function getTodos(
  url = `${store.host}/api/v4/todos?per_page=${numberOfTodos}&access_token=${store.access_token}`,
) {
  let todosString = '';
  const type = "'Todos'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((todos) => {
      if (todos && todos.length > 0) {
        todosString = '<ul class="list-container">';
        todos.forEach((todo) => {
          const item = todo;
          todosString += '<li class="history-entry">';
          let location = '';
          if (item.project) {
            location = item.project.name_with_namespace;
          } else if (item.group) {
            location = item.group.name;
          }
          if (item.target_type === 'DesignManagement::Design') {
            item.target.title = item.body;
          }
          todosString += `<a href="${item.target_url}" target="_blank">${escapeHtml(
            item.target.title,
          )}</a><span class="namespace-with-time">Updated ${timeSince(
            new Date(item.updated_at),
          )} ago &middot; <a href="${item.target_url.split('/-/')[0]}" target="_blank">${escapeHtml(
            location,
          )}</a></span></div></li>`;
        });
        todosString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        todosString = `<div class="zero">${illustration}<p>Take the day off, you have no To-Dos!</p></div>`;
      }
      setElementHtml('#detail-content', todosString);
    });
}

function setupEmptyProjectPage() {
  let emptyPage =
    '<div id="project-pipeline"><div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div></div><div id="project-name"></div></div>';
  emptyPage += '<div class="headline"><span class="name">Issues</span></div>';
  emptyPage +=
    '<div id="project-recent-issues"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  emptyPage += '<div class="headline"><span class="name">Merge requests</span></div>';
  emptyPage +=
    '<div id="project-recent-mrs"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  setElementHtml('#detail-content', emptyPage);
}

function displayProjectPage(project) {
  let logo;
  if (project.avatar_url && project.avatar_url != null && project.visibility === 'public') {
    logo = `<img id="project-detail-avatar" src="${project.avatar_url}?width=64" />`;
  } else {
    logo = `<div id="project-detail-name-avatar">${project.name.charAt(0).toUpperCase()}</div>`;
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml(
    '#detail-header-content',
    `<div id="project-detail-information">
        ${logo}
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-namespace">
          ${escapeHtml(project.namespace.name)}
        </span>
      </div>
      <div class="detail-external-link">
        <a href="${escapeHtml(project.web_url)}" target="_blank">${externalLinkIcon}</a>
      </div>`,
  );
}

async function getProjectIssues(project) {
  let projectIssuesString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const issuesString = "'Issues'";

  const issues = await callApi(`projects/${project.id}/issues`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (issues && issues.length > 0) {
    projectIssuesString = '<ul class="list-container">';
    issues.forEach((issue) => {
      projectIssuesString += '<li class="history-entry">';
      projectIssuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
        issue.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(issue.created_at),
      )} ago &middot; ${escapeHtml(issue.author.name)}</span></div></li>`;
    });
    projectIssuesString += `<li class="more-link"><a onclick="goToSubDetail(${issuesString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectIssuesString += '</ul>';
  } else {
    projectIssuesString = '<p class="no-results with-all-link">No open issues.</p>';
    projectIssuesString += `<div class="all-link"><a onclick="goToSubDetail(${issuesString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-issues', projectIssuesString);
}

async function getProjectMRs(project) {
  let projectMRsString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const mrsString = "'Merge Requests'";

  const mrs = await callApi(`projects/${project.id}/merge_requests`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (mrs && mrs.length > 0) {
    projectMRsString += '<ul class="list-container">';
    mrs.forEach((mr) => {
      projectMRsString += '<li class="history-entry">';
      projectMRsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
        mr.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(mr.created_at),
      )} ago &middot; ${escapeHtml(mr.author.name)}</span></div></li>`;
    });
    projectMRsString += `<li class="more-link"><a onclick="goToSubDetail(${mrsString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectMRsString += '</ul>';
  } else {
    projectMRsString = '<p class="no-results with-all-link">No open merge requests.</p>';
    projectMRsString += `<div class="all-link"><a onclick="goToSubDetail(${mrsString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-mrs', projectMRsString);
}

function addBookmark(link) {
  if (store && store.bookmarks && store.bookmarks.length > 0) {
    const sameBookmarks = store.bookmarks.filter((item) => item.web_url === link);
    if (sameBookmarks.length > 0) {
      displayAddError('bookmark', '-', 'This bookmark has already been added.');
      return;
    }
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("bookmark-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").disabled = "disabled"');
  setElementHtml('#bookmark-add-button', `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then((bookmark) => {
        const allowedTypes = [
          'issues',
          'merge_requests',
          'epics',
          'projects',
          'groups',
          'boards',
          'users',
          'unknown',
        ];

        if (allowedTypes.includes(bookmark.type)) {
          const bookmarks = store.bookmarks || [];
          bookmarks.push(bookmark);
          store.bookmarks = bookmarks;
          getBookmarks();
        } else {
          displayAddError('bookmark', '-');
        }
      })
      .catch(() => {
        displayAddError('bookmark', '-');
      });
  } else {
    displayAddError('bookmark', '-');
  }
}

function addProject(link, target) {
  let newTarget = target;
  if (newTarget === 'project-settings-link') {
    newTarget = '-settings-';
  } else if (newTarget === 'project-overview-link') {
    newTarget = '-overview-';
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}add-button").disabled = "disabled"`,
  );
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}link").disabled = "disabled"`,
  );
  setElementHtml(`#project${newTarget}add-button`, `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then(async (object) => {
        if (
          !store['favorite-projects'] ||
          !store['favorite-projects'].filter((project) => project.web_url === object.web_url).length
        ) {
          if (object.type && object.type !== 'projects') {
            const projectWithNamespace = encodeURIComponent(
              link.split(`${store.host}/`)[1],
            ).replace(/%2F$/, '');
            const project = await callApi(`projects/${projectWithNamespace}`);
            const projects = store['favorite-projects'] || [];
            projects.push({
              id: project.id,
              visibility: project.visibility,
              web_url: project.web_url,
              name: project.name,
              title: project.name,
              namespace: {
                name: project.namespace.name,
              },
              parent_name: project.name_with_namespace,
              parent_url: project.namespace.web_url,
              name_with_namespace: project.name_with_namespace,
              open_issues_count: project.open_issues_count,
              last_activity_at: project.last_activity_at,
              avatar_url: project.avatar_url,
              star_count: project.star_count,
              forks_count: project.forks_count,
            });
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          } else {
            const projects = store['favorite-projects'] || [];
            projects.push(object);
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          }
        } else {
          displayAddError('project', newTarget, 'The same project was already added.');
        }
      })
      .catch(() => {
        displayAddError('project', newTarget);
      });
  } else {
    displayAddError('project', newTarget);
  }
}

function addShortcut(link) {
  const tempArray = [link];
  store.shortcuts = store.shortcuts.concat(tempArray);
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("shortcut-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").disabled = "disabled"');
  setElementHtml('#shortcut-add-button', `${spinner} Add`);
  setupCommandPalette();
  repaintShortcuts();
}

function startBookmarkDialog() {
  const bookmarkLink = "'bookmark-link'";
  const bookmarkInput = `<form action="#" id="bookmark-input" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter your link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-bookmark-dialog").classList.add("opened")');
  setElementHtml('#add-bookmark-dialog', bookmarkInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").focus()');
}

function startProjectDialog() {
  const projectLink = "'project-settings-link'";
  const projectInput = `<form action="#" class="project-input" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-settings-link" placeholder="Enter the link to the project here..." /><button class="add-button" id="project-settings-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-settings-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-project-dialog").classList.add("opened")');
  setElementHtml('#add-project-dialog', projectInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("project-settings-link").focus()');
}

function startShortcutDialog() {
  const shortcutLink = "'shortcut-link'";
  const shortcutInput = `<form action="#" class="shortcut-input" onsubmit="addShortcut(document.getElementById(${shortcutLink}).value);return false;"><input class="shortcut-link" id="shortcut-link" placeholder="Enter the keyboard shortcut here..." /><button class="add-button" id="shortcut-add-button" type="submit">Add</button></form><div class="add-shortcut-error" id="add-shortcut-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-shortcut-dialog").classList.add("opened")');
  setElementHtml('#add-shortcut-dialog', shortcutInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").focus()');
}

function displaySkeleton(count, pagination = false, id = 'detail-content') {
  let skeletonString = '<ul class="list-container empty';
  if (pagination) {
    skeletonString += ' with-pagination">';
  } else {
    skeletonString += '">';
  }
  for (let i = 0; i < count; i += 1) {
    skeletonString +=
      '<li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li>';
  }
  skeletonString += '</ul>';
  setElementHtml(`#${id}`, skeletonString);
}

function changeTheme(option = 'light', manual = false) {
  store.theme = option;
  if (option === 'light') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "light");');
  } else if (option === 'dark') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "dark");');
  }
  if (manual) {
    executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
    executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
    executeUnsafeJavaScript(`document.getElementById("${option}-mode").classList.add("active")`);
  }
}

mb.on('ready', () => {
  setupContextMenu();
  setupCommandPalette();

  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (store.analytics) {
      visitor.event('Visit external link', true).send();
    }
    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });
});

if (store.access_token && store.user_id && store.username) {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();

    mb.showWindow();
    changeTheme(store.theme, false);

    // Preloading content
    getUser();
    getLastTodo();
    getUsersPlan();
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();

    // Regularly relaoading content
    setInterval(() => {
      getLastEvent();
      getLastTodo();
    }, 10000);
  });

  mb.on('show', () => {
    if (store.analytics) {
      visitor.pageview('/').send();
    }
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();
  });
} else {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();
    mb.window.loadURL(`file://${__dirname}/login.html`).then(() => {
      changeTheme(store.theme, false);
      mb.showWindow();
    });
  });
}

ipcMain.on('detail-page', (event, arg) => {
  setElementHtml('#detail-headline', '');
  setElementHtml('#detail-content', '');
  if (arg.page === 'Project') {
    if (store.analytics) {
      visitor.pageview('/project').send();
    }
    setElementHtml(
      '#detail-headline',
      `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="commits-count" class="empty"></span><button onclick="changeCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`,
    );
    setupEmptyProjectPage();
    const project = JSON.parse(arg.object);
    currentProject = project;
    displayProjectPage(project);
    getProjectCommits(project);
    getProjectIssues(project);
    getProjectMRs(project);
  } else {
    executeUnsafeJavaScript(
      'document.getElementById("detail-header-content").classList.remove("empty")',
    );
    setElementHtml('#detail-header-content', arg.page);
    if (arg.page === 'Issues') {
      if (store.analytics) {
        visitor.pageview('/my-issues').send();
      }
      const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
      const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
          <div class="filter-sort">
            ${issuesQuerySelect}
            ${issuesStateSelect}
            ${issuesSortSelect}
          </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfIssues);
      getIssues();
    } else if (arg.page === 'Merge requests') {
      if (store.analytics) {
        visitor.pageview('/my-merge-requests').send();
      }
      let mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label>`;
      if (store.plan !== 'free') {
        mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label>`;
      }
      mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
      const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfMRs);
      getMRs();
    } else if (arg.page === 'To-Do list') {
      if (store.analytics) {
        visitor.pageview('/my-to-do-list').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      setElementHtml(
        '#detail-header-content',
        `${arg.page}<div class="detail-external-link">
        <a href="${escapeHtml(store.host)}/dashboard/todos" target="_blank">
          ${externalLinkIcon}
        </a>
        </div>`,
      );
      displaySkeleton(numberOfTodos);
      getTodos();
    } else if (arg.page === 'Recently viewed') {
      if (store.analytics) {
        visitor.pageview('/my-history').send();
      }
      displaySkeleton(numberOfRecentlyVisited);
      getMoreRecentlyVisited();
    } else if (arg.page === 'Comments') {
      if (store.analytics) {
        visitor.pageview('/my-comments').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      displaySkeleton(numberOfComments);
      getMoreRecentComments();
    }
  }
});

ipcMain.on('sub-detail-page', (event, arg) => {
  isOnSubPage = true;
  activeIssuesQueryOption = 'all';
  activeMRsQueryOption = 'all';
  let activeState = 'Open';
  let allChecked = '';
  let openChecked = ' checked';
  let allChanged = '';
  const project = JSON.parse(arg.project);
  setElementHtml('#sub-detail-headline', '');
  setElementHtml('#sub-detail-content', '');
  executeUnsafeJavaScript(
    'document.getElementById("sub-detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#sub-detail-header-content', arg.page);
  if (arg.page === 'Issues') {
    if (store.analytics) {
      visitor.pageview('/project/issues').send();
    }
    if (arg.all === true) {
      activeIssuesStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
    const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="issues-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}-issues" onchange="switchIssues(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-issues" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${issuesQuerySelect}
          ${issuesStateSelect}
          ${issuesSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfIssues, undefined, 'sub-detail-content');
    getIssues(
      `${store.host}/api/v4/projects/${project.id}/issues?scope=all&state=${activeIssuesStateOption}&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  } else if (arg.page === 'Merge Requests') {
    if (store.analytics) {
      visitor.pageview('/project/merge-requests').send();
    }
    if (arg.all === true) {
      activeMRsStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
    const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="mrs-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}-state" onchange="switchMRs(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-state" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})"><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})" checked><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfMRs, undefined, 'sub-detail-content');
    getMRs(
      `${store.host}/api/v4/projects/${project.id}/merge_requests?scope=all&state=${activeMRsStateOption}&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  }
});

ipcMain.on('back-to-detail-page', () => {
  isOnSubPage = false;
  activeIssuesQueryOption = 'assigned_to_me';
  activeMRsQueryOption = 'assigned_to_me';
});

ipcMain.on('go-to-overview', () => {
  if (store.analytics) {
    visitor.pageview('/').send();
  }
  getRecentlyVisited();
  getRecentComments();
  displayUsersProjects();
  getBookmarks();
  executeUnsafeJavaScript(
    'document.getElementById("detail-headline").classList.remove("with-overflow")',
  );
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.add("empty")',
  );
  setElementHtml('#detail-header-content', '');
  activeIssuesQueryOption = 'assigned_to_me';
  activeIssuesStateOption = 'opened';
  activeIssuesSortOption = 'created_at';
  activeMRsQueryOption = 'assigned_to_me';
  activeMRsStateOption = 'opened';
  activeMRsSortOption = 'created_at';
  moreRecentlyVisitedArray = [];
  recentProjectCommits = [];
  currentProjectCommit = null;
  currentProject = null;
});

ipcMain.on('go-to-settings', () => {
  openSettingsPage();
});

ipcMain.on('switch-issues', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch issues', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeIssuesQueryOption) {
    activeIssuesQueryOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-query-active', arg.text);
    if (
      (isOnSubPage === false && arg.label !== 'assigned_to_me') ||
      (isOnSubPage === true && arg.label !== 'all')
    ) {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'state' && arg.label !== activeIssuesStateOption) {
    activeIssuesStateOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeIssuesSortOption) {
    activeIssuesSortOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.remove("changed")',
      );
    }
  }
  url += `issues?scope=${activeIssuesQueryOption}&state=${activeIssuesStateOption}&order_by=${activeIssuesSortOption}&per_page=${numberOfIssues}&access_token=${store.access_token}`;
  getIssues(url, id);
});

ipcMain.on('switch-mrs', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch merge requests', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeMRsQueryOption) {
    activeMRsQueryOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-query-active', arg.text);
    if (arg.label !== 'all') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.remove("changed")',
      );
    }
  }
  if (arg.type === 'state' && arg.label !== activeMRsStateOption) {
    activeMRsStateOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeMRsSortOption) {
    activeMRsSortOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.remove("changed")',
      );
    }
  }
  url += 'merge_requests?scope=';
  if (activeMRsQueryOption === 'assigned_to_me' || activeMRsQueryOption === 'created_by_me') {
    url += activeMRsQueryOption;
  } else if (activeMRsQueryOption === 'approved_by_me') {
    url += `all&approved_by_ids[]=${store.user_id}`;
  } else if (activeMRsQueryOption === 'review_requests_for_me') {
    url += `all&reviewer_id=${store.user_id}`;
  } else if (activeMRsQueryOption === 'approval_rule_for_me') {
    url += `all&approver_ids[]=${store.user_id}`;
  }
  url += `&state=${activeMRsStateOption}&order_by=${activeMRsSortOption}&per_page=${numberOfMRs}&access_token=${store.access_token}`;
  getMRs(url, id);
});

ipcMain.on('switch-page', (event, arg) => {
  let id;
  if (isOnSubPage) {
    id = 'sub-detail-content';
  } else {
    id = 'detail-content';
  }
  if (arg.type === 'Todos') {
    displaySkeleton(numberOfTodos, true);
    getTodos(arg.url);
  } else if (arg.type === 'Issues') {
    displaySkeleton(numberOfIssues, true, id);
    getIssues(arg.url, id);
  } else if (arg.type === 'MRs') {
    displaySkeleton(numberOfMRs, true, id);
    getMRs(arg.url, id);
  } else if (arg.type === 'Comments') {
    displaySkeleton(numberOfComments, true);
    getMoreRecentComments(arg.url);
  }
});

ipcMain.on('search-recent', (event, arg) => {
  setElementHtml('#detail-content', '');
  searchRecentlyVisited(arg);
});

ipcMain.on('change-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate my commits', 'next').send();
    } else {
      visitor.event('Navigate my commits', 'previous').send();
    }
  }
  setElementHtml(
    '#pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentCommits, currentCommit);
  currentCommit = nextCommit;
  getCommitDetails(nextCommit.project_id, nextCommit.push_data.commit_to, nextCommit.index);
});

ipcMain.on('change-project-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate project commits', 'next').send();
    } else {
      visitor.event('Navigate project commits', 'previous').send();
    }
  }
  setElementHtml(
    '#project-pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentProjectCommits, currentProjectCommit);
  currentProjectCommit = nextCommit;
  getProjectCommitDetails(currentProject.id, nextCommit.id, nextCommit.index);
});

ipcMain.on('add-bookmark', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add bookmark').send();
  }
  addBookmark(arg);
});

ipcMain.on('add-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add project').send();
  }
  addProject(arg.input, arg.target);
});

ipcMain.on('add-shortcut', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add shortcut').send();
  }
  addShortcut(arg);
});

ipcMain.on('start-bookmark-dialog', () => {
  startBookmarkDialog();
});

ipcMain.on('start-project-dialog', () => {
  startProjectDialog();
});

ipcMain.on('start-shortcut-dialog', () => {
  startShortcutDialog();
});

ipcMain.on('delete-bookmark', (event, hashedUrl) => {
  if (store.analytics) {
    visitor.event('Delete bookmark').send();
  }
  if (store.bookmarks && store.bookmarks.length > 0) {
    const newBookmarks = store.bookmarks.filter(
      (bookmark) => sha256hex(bookmark.web_url) !== hashedUrl,
    );
    store.bookmarks = newBookmarks;
  }
  getBookmarks();
});

ipcMain.on('delete-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Delete project').send();
  }
  const projects = store['favorite-projects'];
  const newProjects = projects.filter((project) => project.id !== arg);
  store['favorite-projects'] = newProjects;
  // TODO Implement better way to refresh view after deleting project
  displayUsersProjects();
  openSettingsPage();
});

ipcMain.on('delete-shortcut', (event, arg) => {
  store.shortcuts = store.shortcuts.filter((keys) => keys !== arg);
  setupCommandPalette();
  repaintShortcuts();
});

ipcMain.on('change-theme', (event, arg) => {
  if (store.analytics) {
    visitor.event('Change theme', arg).send();
  }
  changeTheme(arg, true);
});

ipcMain.on('change-analytics', (event, arg) => {
  store.analytics = arg;
  if (store.analytics) {
    visitor = ua('UA-203420427-1', store.analytics_id);
  } else {
    visitor = null;
  }
});

ipcMain.on('change-keep-visible', (event, arg) => {
  store.keep_visible = arg;
  mb.window.setAlwaysOnTop(arg);
});

ipcMain.on('change-show-dock-icon', (event, arg) => {
  mb.window.setAlwaysOnTop(true);
  store.show_dock_icon = arg;
  if (arg) {
    app.dock.show().then(() => {
      mb.window.setAlwaysOnTop(store.keep_visible);
    });
  } else {
    app.dock.hide();
    app.focus({
      steal: true,
    });
    setTimeout(() => {
      app.focus({
        steal: true,
      });
      mb.window.setAlwaysOnTop(store.keep_visible);
    }, 200);
  }
});

ipcMain.on('choose-certificate', () => {
  chooseCertificate();
});

ipcMain.on('reset-certificate', () => {
  executeUnsafeJavaScript('document.getElementById("custom-cert-path-text").innerText=""');
  executeUnsafeJavaScript(
    'document.getElementById("custom-cert-path-text").classList.add("hidden")',
  );
  chooseCertificate();
});

ipcMain.on('start-login', () => {
  startLogin();
});

ipcMain.on('start-manual-login', (event, arg) => {
  if (arg.custom_cert_path) {
    saveUser(arg.access_token, arg.host, arg.custom_cert_path);
  } else {
    saveUser(arg.access_token, arg.host);
  }
});

ipcMain.on('logout', () => {
  if (store.analytics) {
    visitor.event('Log out', true).send();
  }
  logout();
});

/* eslint-env es2021 */
const { menubar } = require('menubar');
const { Menu, Notification, shell, ipcMain, dialog, app } = require('electron');
const { URL } = require('url');
const ua = require('universal-analytics');
const jsdom = require('jsdom');
const nodeCrypto = require('crypto');
const { escapeHtml, escapeQuotes, escapeSingleQuotes, sha256hex } = require('./lib/util');
const GitLab = require('./lib/gitlab');
const {
  chevronLgLeftIcon,
  chevronLgLeftIconWithViewboxHack,
  chevronLgRightIcon,
  chevronLgRightIconWithViewboxHack,
  chevronRightIcon,
  externalLinkIcon,
  projectIcon,
  removeIcon,
  todosAllDoneIllustration,
} = require('./src/icons');
const {
  allLabel,
  allText,
  approvalLabel,
  approvalText,
  approvedLabel,
  approvedText,
  assignedLabel,
  assignedText,
  closedLabel,
  closedText,
  createdLabel,
  createdText,
  dueDateLabel,
  dueDateText,
  mergedLabel,
  mergedText,
  openedLabel,
  openedText,
  query,
  recentlyCreatedLabel,
  recentlyCreatedText,
  recentlyUpdatedLabel,
  recentlyUpdatedText,
  reviewedLabel,
  reviewedText,
  sort,
  state,
} = require('./src/filter-text');
const { store, deleteFromStore } = require('./lib/store');
const BrowserHistory = require('./lib/browser-history');
const processInfo = require('./lib/process-info');
const { version } = require('./package.json');
const CommandPalette = require('./src/command-palette');
// eslint-disable-next-line no-shadow
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { JSDOM } = jsdom;
let commandPalette;
global.DOMParser = new JSDOM().window.DOMParser;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let visitor;
if (store.analytics) {
  visitor = ua('UA-203420427-1', store.analytics_id);
}
let recentlyVisitedString = '';
let currentProject;
let moreRecentlyVisitedArray = [];
let recentCommits = [];
let currentCommit;
let lastEventId;
let lastTodoId = -1;
let recentProjectCommits = [];
let currentProjectCommit;
const numberOfRecentlyVisited = 3;
const numberOfFavoriteProjects = 5;
const numberOfRecentComments = 3;
const numberOfIssues = 10;
const numberOfMRs = 10;
const numberOfTodos = 10;
const numberOfComments = 5;
let activeIssuesQueryOption = 'assigned_to_me';
let activeIssuesStateOption = 'opened';
let activeIssuesSortOption = 'created_at';
let activeMRsQueryOption = 'assigned_to_me';
let activeMRsStateOption = 'opened';
let activeMRsSortOption = 'created_at';
let runningPipelineSubscriptions = [];
let runningPipelineSubscriptionInterval = -1;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let isOnSubPage = false;

// Anti rebound variables
const delay = 2000;
let lastUserExecution = 0;
let lastRecentlyVisitedExecution = 0;
let lastLastCommitsExecution = 0;
let lastRecentCommentsExecution = 0;

let lastUserExecutionFinished = true;
let lastRecentlyVisitedExecutionFinished = true;
let lastLastCommitsExecutionFinished = true;
let lastRecentCommentsExecutionFinished = true;

let refreshInProgress = false;

let verifier = '';
let challenge = '';

const mb = menubar({
  showDockIcon: store.show_dock_icon,
  showOnAllWorkspaces: false,
  icon: `${__dirname}/assets/gitlabTemplate.png`,
  preloadWindow: true,
  browserWindow: {
    width: 550,
    height: 700,
    minWidth: 265,
    minHeight: 300,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      nodeIntegration: process.env.NODE_ENV === 'test',
      contextIsolation: process.env.NODE_ENV !== 'test',
      enableRemoteModule: process.env.NODE_ENV === 'test',
    },
    alwaysOnTop: store.keep_visible,
  },
});

const executeUnsafeJavaScript = (js) => mb.window.webContents.executeJavaScript(js);

const setElementHtml = (selector, html) =>
  // This is caused by a Pretter/eslint mismatch
  // eslint-disable-next-line implicit-arrow-linebreak
  executeUnsafeJavaScript(
    `document.querySelector("${escapeQuotes(selector)}").innerHTML = "${escapeQuotes(html).replace(
      /\n/g,
      '\\n',
    )}"`,
  );

// eslint-disable-next-line object-curly-newline
async function callApi(what, options = {}, host = store.host) {
  return new Promise((resolve, reject) => {
    GitLab.get(what, options, host)
      .then((result) => {
        if (result && result.error) {
          // eslint-disable-next-line no-use-before-define
          tryRefresh();
        }
        resolve(result);
      })
      .catch(() => {
        reject();
      });
  });
}

function openSettingsPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/settings').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'Settings');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  const lightString = "'light'";
  const darkString = "'dark'";
  setElementHtml('#detail-headline', '<span class="name">Theme</span>');
  let settingsString = '';
  const theme = `<div id="theme-selection"><div id="light-mode" class="theme-option" onclick="changeTheme(${lightString})"><div class="indicator"></div>Light</div><div id="dark-mode" class="theme-option" onclick="changeTheme(${darkString})"><div class="indicator"></div>Dark</div></div>`;
  if (store.user_id && store.username) {
    const projects = store['favorite-projects'];
    let favoriteProjects =
      '<div class="headline"><span class="name">Favorite projects</span></div><div id="favorite-projects"><ul class="list-container">';
    if (projects && projects.length > 0) {
      projects.forEach((project) => {
        favoriteProjects += `<li>${projectIcon}<div class="name-with-namespace"><span>${escapeHtml(
          project.name,
        )}</span><span class="namespace">${escapeHtml(project.namespace.name)}</span></div>`;
        favoriteProjects += `<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteProject(${project.id})">${removeIcon}</div></div></li>`;
      });
    }
    favoriteProjects += `<li id="add-project-dialog" class="more-link"><a onclick="startProjectDialog()">Add another project ${chevronRightIcon}</a></li></ul></div>`;
    let preferences =
      '<div class="headline"><span class="name">Preferences</span></div><div id="preferences"><form id="prerefences-form">';
    preferences += '<div><input type="checkbox" id="keep-visible" name="keep-visible" ';
    if (store.keep_visible) {
      preferences += ' checked="checked"';
    }
    preferences +=
      'onchange="changeKeepVisible(this.checked)"/><label for="keep-visible">Keep GitDock visible, even when losing focus.</label></div>';
    if (processInfo.platform === 'darwin') {
      preferences += '<div><input type="checkbox" id="show-dock-icon" name="show-dock-icon" ';
      if (store.show_dock_icon) {
        preferences += ' checked="checked"';
      }
      preferences +=
        'onchange="changeShowDockIcon(this.checked)"/><label for="show-dock-icon">Show icon also in dock, not only in menubar.</label></div>';
    }
    preferences += '</form></div>';
    let shortcut =
      '<div class="headline"><span class="name">Command Palette shortcuts</span></div><div id="shortcut"><p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p>';
    if (store.shortcuts) {
      shortcut += '<ul class="list-container">';
      store.shortcuts.forEach((keys) => {
        shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
      });
      shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
    }
    shortcut += '</div>';
    let analyticsString =
      '<div class="headline"><span class="name">Analytics</span></div><div id="analytics">';
    analyticsString +=
      'To better understand how you make use of GitDock features to navigate around your issues, MRs, and other areas, we would love to collect insights about your usage. All data is 100% anonymous and we do not track the specific content (projects, issues...) you are interacting with, only which kind of areas you are using.</div>';
    analyticsString += `<form id="analytics-form"><div><input type="radio" id="analytics-yes" name="analytics" value="yes"${
      store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(true)"><label for="analytics-yes">Yes, collect anonymous data.</label></div><div><input type="radio" id="analytics-no" name="analytics" value="no"${
      !store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(false)"><label for="analytics-no">No, do not collect any data.</label></div></form>`;
    const signout =
      '<div class="headline"><span class="name">User</span></div><div id="user-administration"><button id="logout-button" onclick="logout()">Log out</button></div>';
    settingsString = theme + favoriteProjects + preferences + shortcut + analyticsString + signout;
  } else {
    settingsString = theme;
  }
  setElementHtml('#detail-content', `${settingsString}</div>`);
  executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
  executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
  executeUnsafeJavaScript(`document.getElementById("${store.theme}-mode").classList.add("active")`);
}

function openAboutPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/about').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'About GitDock ⚓️');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  setElementHtml('#detail-headline', '<span class="name">About GitDock ⚓️</span>');
  let aboutString =
    '<p>GitDock is a MacOS/Windows/Linux app that displays all your GitLab activities in one place. Instead of the GitLab typical project- or group-centric approach, it collects all your information from a user-centric perspective.</p>';
  aboutString +=
    '<p>If you want to learn more about why we built this app, you can have a look at our <a href="https://about.gitlab.com/blog/2021/10/05/gitpod-desktop-app-personal-activities" target="_blank">blog post</a>.</p>';
  aboutString +=
    '<p>We use issues to collect bugs, feature requests, and more. You can <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues" target="_blank">browse through existing issues</a>. To report a bug, suggest an improvement, or propose a feature, please <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues/new">create a new issue</a> if there is not already an issue for it.</p>';
  aboutString +=
    '<p>If you are thinking about contributing directly, check out our <a href="https://gitlab.com/mvanremmerden/gitdock/-/blob/main/CONTRIBUTING.md" target="_blank">contribution guidelines</a>.</p>';
  aboutString += `<p class="version-number">Version ${version}</p>`;
  setElementHtml('#detail-content', `${aboutString}</div>`);
}

function setupLinuxContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GitDock',
      click: () => mb.showWindow(),
      visible: processInfo.platform === 'linux',
    },
    ...baseMenuItems,
  ]);

  mb.tray.setContextMenu(menu);
}

function setupGenericContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate(baseMenuItems);

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(menu);
  });
}

function setupContextMenu() {
  const baseMenuItems = [
    {
      label: 'Settings',
      click: () => {
        openSettingsPage();
      },
    },
    {
      label: 'About',
      click: () => {
        openAboutPage();
      },
    },
    {
      label: 'Quit',
      click: () => {
        mb.app.quit();
      },
    },
  ];

  if (processInfo.platform === 'linux') {
    setupLinuxContextMenu(baseMenuItems);
  } else {
    setupGenericContextMenu(baseMenuItems);
  }
}

function setupCommandPalette() {
  if (!commandPalette) {
    commandPalette = new CommandPalette();
  }

  commandPalette.register({
    shortcut: store.shortcuts,
  });
}

function chooseCertificate() {
  mb.window.setAlwaysOnTop(true);
  const filepaths = dialog.showOpenDialogSync();
  setTimeout(() => {
    mb.window.setAlwaysOnTop(false);
  }, 200);
  if (filepaths) {
    const filepath = filepaths[0].replace(/\\/g, '/'); // convert \ to / otherwise separators get lost on windows
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-button").classList.add("hidden")',
    );
    executeUnsafeJavaScript(
      `document.getElementById("custom-cert-path-text").innerText="${filepath}"`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-text").classList.remove("hidden")',
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-reset").classList.remove("hidden")',
    );
  }
}

function repaintShortcuts() {
  let shortcut =
    '<p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p><ul class="list-container">';
  if (store.shortcuts) {
    store.shortcuts.forEach((keys) => {
      shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
    });
    shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
  }
  shortcut += '</div>';
  setElementHtml('#shortcut', shortcut);
}

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function timeSince(date, direction = 'since') {
  let seconds;
  if (direction === 'since') {
    seconds = Math.floor((new Date() - date) / 1000);
  } else if (direction === 'to') {
    seconds = Math.floor((date - new Date()) / 1000);
  }
  let interval = seconds / 31536000;
  if (interval >= 2) {
    return `${Math.floor(interval)} years`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} year`;
  }
  interval = seconds / 2592000;
  if (interval > 2) {
    return `${Math.floor(interval)} months`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} month`;
  }
  interval = seconds / 604800;
  if (interval > 2) {
    return `${Math.floor(interval)} weeks`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} week`;
  }
  interval = seconds / 86400;
  if (interval > 2) {
    return `${Math.floor(interval)} days`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} day`;
  }
  interval = seconds / 3600;
  if (interval >= 2) {
    return `${Math.floor(interval)} hours`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} hour`;
  }
  interval = seconds / 60;
  if (interval > 2) {
    return `${Math.floor(interval)} minutes`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} minute`;
  }
  return `${Math.floor(seconds)} seconds`;
}

function logout() {
  deleteFromStore('user_id');
  deleteFromStore('username');
  deleteFromStore('access_token');
  deleteFromStore('custom_cert_path');
  deleteFromStore('host');
  deleteFromStore('plan');
  mb.window.webContents.session.clearCache();
  mb.window.webContents.session.clearStorageData();
  app.quit();
  app.relaunch();
}

function displayUsersProjects() {
  let favoriteProjectsHtml = '';
  const projects = store['favorite-projects'];
  if (projects && projects.length > 0) {
    favoriteProjectsHtml += '<ul class="list-container clickable" data-testid="favorite-projects">';
    const chevron = chevronLgRightIcon;
    projects.forEach((projectObject) => {
      const projectString = "'Project'";
      const jsonProjectObject = JSON.parse(JSON.stringify(projectObject));
      jsonProjectObject.name_with_namespace = projectObject.name_with_namespace;
      jsonProjectObject.namespace.name = projectObject.namespace.name;
      jsonProjectObject.name = projectObject.name;
      const projectJson = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
      favoriteProjectsHtml += `<li onclick="goToDetail(${projectString}, ${projectJson})">${projectIcon}`;
      favoriteProjectsHtml += `<div class="name-with-namespace"><span>${escapeHtml(
        projectObject.name,
      )}</span><span class="namespace">${escapeHtml(
        projectObject.namespace.name,
      )}</span></div><div class="chevron-right-wrapper">${chevron}</div></li>`;
    });
    favoriteProjectsHtml += '</ul>';
  } else {
    const projectLink = "'project-overview-link'";
    favoriteProjectsHtml = `<div class="new-project"><div><span class="cta">Track projects you care about</span> 🌟</div><div class="cta-description">Add any project you want a directly accessible shortcut for.</div><form class="project-input" action="#" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-overview-link" placeholder="Enter the project link here..." /><button class="add-button" id="project-overview-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-overview-error"></div></div>`;
  }
  setElementHtml('#projects', favoriteProjectsHtml);
}

async function getUsersProjects() {
  const projects = await callApi(`users/${store.user_id}/starred_projects`, {
    min_access_level: 30,
    per_page: numberOfFavoriteProjects,
    order_by: 'updated_at',
  });
  if (projects) {
    return projects.map((project) => ({
      id: project.id,
      visibility: project.visibility,
      web_url: project.web_url,
      name: project.name,
      namespace: {
        name: project.namespace.name,
      },
      added: Date.now(),
      name_with_namespace: project.name_with_namespace,
      open_issues_count: project.open_issues_count,
      last_activity_at: project.last_activity_at,
      avatar_url: project.avatar_url,
      star_count: project.star_count,
      forks_count: project.forks_count,
    }));
  }
  return false;
}

function getBookmarks() {
  const { bookmarks } = store;
  let bookmarksString = '';
  if (bookmarks && bookmarks.length > 0) {
    bookmarksString = '<ul class="list-container">';
    bookmarks.forEach((bookmark) => {
      let namespaceLink = '';
      if (bookmark.parent_name && bookmark.parent_url) {
        namespaceLink = ` &middot; <a href="${bookmark.parent_url}" target="_blank">${escapeHtml(
          bookmark.parent_name,
        )}</a>`;
      }

      let { title } = bookmark;

      if (bookmark.id && ['merge_requests', 'issues'].includes(bookmark.type)) {
        const typeIndicator = GitLab.indicatorForType(bookmark.type);
        title += ` (${typeIndicator}${bookmark.id})`;
      }

      bookmarksString += `<li class="history-entry bookmark-entry"><div class="bookmark-information"><a href="${escapeSingleQuotes(
        escapeHtml(bookmark.web_url),
      )}" id="bookmark-title" target="_blank">${escapeHtml(
        title,
      )}</a><span class="namespace-with-time">Added ${timeSince(
        bookmark.added,
      )} ago${namespaceLink}</span></div><div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteBookmark('${sha256hex(
        bookmark.web_url,
      )}')">${removeIcon}</div></div></li>`;
    });
    bookmarksString += `<li id="add-bookmark-dialog" class="more-link"><a onclick="startBookmarkDialog()">Add another bookmark ${chevronRightIcon}</a></li></ul>`;
  } else {
    const bookmarkLink = "'bookmark-link'";
    bookmarksString = `<div id="new-bookmark"><div><span class="cta">Add a new GitLab bookmark</span> 🔖</div><div class="cta-description">Bookmarks are helpful when you have an issue/merge request you will have to come back to repeatedly.</div><form id="bookmark-input" action="#" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter the link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div></div>`;
  }
  setElementHtml('#bookmarks', bookmarksString);
}

async function getRecentlyVisited() {
  if (lastRecentlyVisitedExecutionFinished && lastRecentlyVisitedExecution + delay < Date.now()) {
    lastRecentlyVisitedExecutionFinished = false;
    const recentlyVisitedArray = [];
    recentlyVisitedString = '';
    let firstItem = true;
    await BrowserHistory.getAllHistory().then(async (history) => {
      const item = Array.prototype.concat.apply([], history);
      item.sort((a, b) => {
        if (a.utc_time > b.utc_time) {
          return -1;
        }
        if (b.utc_time > a.utc_time) {
          return 1;
        }
        return -1;
      });
      let i = 0;
      for (let j = 0; j < item.length; j += 1) {
        if (
          item[j].title &&
          item[j].url.indexOf(`${store.host}/`) === 0 &&
          (item[j].url.indexOf('/-/issues/') !== -1 ||
            item[j].url.indexOf('/-/merge_requests/') !== -1 ||
            item[j].url.indexOf('/-/epics/') !== -1) &&
          !recentlyVisitedArray.includes(item[j].title) &&
          item[j].title.split('·')[0] !== 'Not Found' &&
          item[j].title.split('·')[0] !== 'New Issue ' &&
          item[j].title.split('·')[0] !== 'New Merge Request ' &&
          item[j].title.split('·')[0] !== 'New merge request ' &&
          item[j].title.split('·')[0] !== 'New Epic ' &&
          item[j].title.split('·')[0] !== 'Edit ' &&
          item[j].title.split('·')[0] !== 'Merge requests ' &&
          item[j].title.split('·')[0] !== 'Issues '
        ) {
          if (firstItem) {
            recentlyVisitedString = '<ul class="list-container">';
            firstItem = false;
          }
          const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
          if (nameWithNamespace.split('/')[0] !== 'groups') {
            item.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
              nameWithNamespace.split('/')[1]
            }?access_token=${store.access_token}`;
          } else {
            item.url = `${store.host}/api/v4/groups/${
              nameWithNamespace.split('/')[0]
            }?access_token=${store.access_token}`;
          }
          recentlyVisitedArray.push(item[j].title);
          if (item[j].title !== 'Checking your Browser - GitLab') {
            recentlyVisitedString += '<li class="history-entry">';
            recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
              item[j].title.split('·')[0],
            )}</a><span class="namespace-with-time">${timeSince(
              new Date(`${item[j].utc_time} UTC`),
            )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
              item[j].title.split('·')[2].trim(),
            )}</a></span></div></li>`;
            i += 1;
            if (i === numberOfRecentlyVisited) {
              break;
            }
          }
        }
      }
      if (!firstItem) {
        const moreString = "'Recently viewed'";
        recentlyVisitedString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
      } else if (BrowserHistory.isSupported()) {
        recentlyVisitedString = `<p class="no-results">Recently visited objects will show up here.<br/><span class="supported-browsers">Supported browsers: ${BrowserHistory.supportedBrowserNames()}.</span></p>`;
      } else {
        recentlyVisitedString =
          '<p class="no-results"><span class="supported-browsers">No browsers are supported on your operating system yet.</span></p>';
      }
      setElementHtml('#history', recentlyVisitedString);
      lastRecentlyVisitedExecution = Date.now();
      lastRecentlyVisitedExecutionFinished = true;
    });
  }
}

async function subscribeToRunningPipeline() {
  if (runningPipelineSubscriptionInterval !== -1) {
    clearInterval(runningPipelineSubscriptionInterval);
  }
  runningPipelineSubscriptionInterval = setInterval(async () => {
    runningPipelineSubscriptions.forEach(async (runningPipeline) => {
      const pipeline = await callApi(
        `projects/${runningPipeline.project_id}/pipelines/${runningPipeline.id}`,
      );
      if (pipeline) {
        let pipelineStatus;
        if (pipeline.status !== 'running') {
          if (pipeline.status === 'success') {
            pipelineStatus = 'succeeded';
          } else {
            pipelineStatus = pipeline.status;
          }
          const updateNotification = new Notification({
            title: `Pipeline ${pipelineStatus}`,
            subtitle: GitLab.fetchUrlInfo(pipeline.web_url).namespaceWithProject,
            body: runningPipeline.commit_title,
          });
          updateNotification.on('click', () => {
            shell.openExternal(pipeline.web_url);
          });
          updateNotification.show();
          runningPipelineSubscriptions = runningPipelineSubscriptions.filter(
            (subscriptionPipeline) => subscriptionPipeline.id !== pipeline.id,
          );
          if (runningPipelineSubscriptions.length === 0) {
            clearInterval(runningPipelineSubscriptionInterval);
            runningPipelineSubscriptionInterval = -1;
            mb.tray.setImage(`${__dirname}/assets/gitlabTemplate.png`);
          }
        }
      }
    });
  }, 10000);
}

async function getLastPipelines(commits) {
  const projectArray = [];
  if (commits && commits.length > 0) {
    commits.forEach(async (commit) => {
      if (!projectArray.includes(commit.project_id)) {
        projectArray.push(commit.project_id);
        const pipelines = await callApi(`projects/${commit.project_id}/pipelines`, {
          status: 'running',
          username: store.username,
          per_page: 1,
          page: 1,
        });
        if (pipelines && pipelines.length > 0) {
          mb.tray.setImage(`${__dirname}/assets/runningTemplate.png`);
          pipelines.forEach(async (pipeline) => {
            const commitPipeline = pipeline;
            if (
              runningPipelineSubscriptions.findIndex(
                (subscriptionPipeline) => subscriptionPipeline.id === pipeline.id,
              ) === -1
            ) {
              const pipelineCommit = await callApi(
                `projects/${pipeline.project_id}/repository/commits/${pipeline.sha}`,
              );
              if (pipelineCommit) {
                commitPipeline.commit_title = pipelineCommit.title;
                runningPipelineSubscriptions.push(commitPipeline);
                const runningNotification = new Notification({
                  title: 'Pipeline running',
                  subtitle: GitLab.fetchUrlInfo(commitPipeline.web_url).namespaceWithProject,
                  body: commitPipeline.commit_title,
                });
                runningNotification.on('click', () => {
                  shell.openExternal(commitPipeline.web_url);
                });
                runningNotification.show();
              }
            }
          });
          subscribeToRunningPipeline();
        }
      }
    });
  }
}

function displayAddError(type, target, customMessage) {
  executeUnsafeJavaScript(
    `document.getElementById("add-${type}${target}error").style.display = "block"`,
  );
  if (customMessage) {
    setElementHtml(`#add-${type}${target}error`, customMessage);
  } else {
    setElementHtml(`#add-${type}${target}error`, `This is not a valid GitLab ${type} URL.`);
  }
  executeUnsafeJavaScript(`document.getElementById("${type}${target}add-button").disabled = false`);
  executeUnsafeJavaScript(`document.getElementById("${type}${target}link").disabled = false`);
  setElementHtml(`#${type}${target}add-button`, 'Add');
}

function displayPagination(keysetLinks, type) {
  let paginationString = '';
  if (keysetLinks.indexOf('rel="next"') !== -1 || keysetLinks.indexOf('rel="prev"') !== -1) {
    paginationString += '<div id="pagination">';
    if (keysetLinks.indexOf('rel="prev"') !== -1) {
      let prevLink = '';
      prevLink = escapeHtml(`"${keysetLinks.split('>; rel="prev"')[0].substring(1)}"`);
      paginationString += `<button onclick="switchPage(${prevLink}, ${type})" class="prev">${chevronLgLeftIcon} Previous</button>`;
    } else {
      paginationString += '<div></div>';
    }
    if (keysetLinks.indexOf('rel="next"') !== -1) {
      let nextLink = '';
      if (keysetLinks.indexOf('rel="prev"') !== -1) {
        nextLink = escapeHtml(
          `"${keysetLinks.split('rel="prev", ')[1].split('>; rel="next"')[0].substring(1)}"`,
        );
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      } else {
        nextLink = escapeHtml(`"${keysetLinks.split('>; rel="next"')[0].substring(1)}"`);
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      }
    } else {
      paginationString += '<div></div>';
    }
    paginationString += '</div>';
  }
  return paginationString;
}

function renderCollabject(comment, collabject) {
  const collabObject = collabject;
  if (collabObject.message && collabObject.message === '404 Not found') {
    return 0;
  }
  if (comment.note.noteable_type === 'DesignManagement::Design') {
    collabObject.web_url += `/designs/${comment.target_title}`;
    return `<li class="comment"><a href="${collabObject.web_url}#note_${
      comment.note.id
    }" target="_blank">${escapeHtml(
      comment.note.body,
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(comment.created_at),
    )} ago &middot; <a href="${
      collabObject.web_url.split('#note')[0]
    }" target="_blank">${escapeHtml(comment.target_title)}</a></span></div></li>`;
  }
  return `<li class="comment"><a href="${collabObject.web_url}#note_${
    comment.note.id
  }" target="_blank">${escapeHtml(
    comment.note.body,
  )}</a><span class="namespace-with-time">${timeSince(
    new Date(comment.created_at),
  )} ago &middot; <a href="${collabObject.web_url.split('#note')[0]}" target="_blank">${escapeHtml(
    comment.target_title,
  )}</a></span></div></li>`;
}

function displayCommit(commit, project, focus = 'project') {
  let logo = '';
  if (commit.last_pipeline) {
    logo += `<a target="_blank" href="${commit.last_pipeline.web_url}" class="pipeline-link">`;
    if (commit.last_pipeline.status === 'scheduled') {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7"/><circle class="icon" style="fill: var(--svg-status-bg, #c9d1d9);" cx="7" cy="7" r="6"/><g transform="translate(2.75 2.75)" fill-rule="nonzero"><path d="M4.165 7.81a3.644 3.644 0 1 1 0-7.29 3.644 3.644 0 0 1 0 7.29zm0-1.042a2.603 2.603 0 1 0 0-5.206 2.603 2.603 0 0 0 0 5.206z"/><rect x="3.644" y="2.083" width="1.041" height="2.603" rx=".488"/><rect x="3.644" y="3.644" width="2.083" height="1.041" rx=".488"/></g></svg>';
    } else {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="M0 7a7 7 0 1 1 14 0A7 7 0 0 1 0 7z" class="icon"/><path d="M13 7A6 6 0 1 0 1 7a6 6 0 0 0 12 0z" class="icon-inverse" />';
      if (commit.last_pipeline.status === 'running') {
        logo +=
          '<path d="M7 3c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.3 0-2.5-.7-3.3-1.7L7 7V3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'failed') {
        logo +=
          '<path d="M7 5.969L5.599 4.568a.29.29 0 0 0-.413.004l-.614.614a.294.294 0 0 0-.004.413L5.968 7l-1.4 1.401a.29.29 0 0 0 .004.413l.614.614c.113.114.3.117.413.004L7 8.032l1.401 1.4a.29.29 0 0 0 .413-.004l.614-.614a.294.294 0 0 0 .004-.413L8.032 7l1.4-1.401a.29.29 0 0 0-.004-.413l-.614-.614a.294.294 0 0 0-.413-.004L7 5.968z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'success') {
        logo +=
          '<path d="M6.278 7.697L5.045 6.464a.296.296 0 0 0-.42-.002l-.613.614a.298.298 0 0 0 .002.42l1.91 1.909a.5.5 0 0 0 .703.005l.265-.265L9.997 6.04a.291.291 0 0 0-.009-.408l-.614-.614a.29.29 0 0 0-.408-.009L6.278 7.697z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'pending') {
        logo +=
          '<path d="M4.7 5.3c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H5c-.2 0-.3-.1-.3-.3V5.3m3 0c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H8c-.2 0-.3-.1-.3-.3V5.3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'canceled') {
        logo +=
          '<path d="M5.2 3.8l4.9 4.9c.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0L3.8 5.2c-.2-.2-.2-.5 0-.7l.7-.7c.2-.2.5-.2.7 0" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'skipped') {
        logo +=
          '<path d="M6.415 7.04L4.579 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L5.341 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L6.415 7.04zm2.54 0L7.119 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L7.881 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L8.955 7.04z" class="icon"/></svg>';
      } else if (commit.last_pipeline.status === 'created') {
        logo += '<circle cx="7" cy="7" r="3.25" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'preparing') {
        logo +=
          '</g><circle cx="7" cy="7" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="4" cy="7" r="1"/></g></svg>';
      } else if (commit.last_pipeline.status === 'manual') {
        logo +=
          '<path d="M10.5 7.63V6.37l-.787-.13c-.044-.175-.132-.349-.263-.61l.481-.652-.918-.913-.657.478a2.346 2.346 0 0 0-.612-.26L7.656 3.5H6.388l-.132.783c-.219.043-.394.13-.612.26l-.657-.478-.918.913.437.652c-.131.218-.175.392-.262.61l-.744.086v1.261l.787.13c.044.218.132.392.263.61l-.438.651.92.913.655-.434c.175.086.394.173.613.26l.131.783h1.313l.131-.783c.219-.043.394-.13.613-.26l.656.478.918-.913-.48-.652c.13-.218.218-.435.262-.61l.656-.13zM7 8.283a1.285 1.285 0 0 1-1.313-1.305c0-.739.57-1.304 1.313-1.304.744 0 1.313.565 1.313 1.304 0 .74-.57 1.305-1.313 1.305z" class="icon"/></g></svg>';
      }
    }
  }
  logo += '</a>';
  let subline;
  if (focus === 'project') {
    subline = `<a href="${project.web_url}" target=_blank">${escapeHtml(
      project.name_with_namespace,
    )}</a>`;
  } else {
    subline = escapeHtml(commit.author_name);
  }
  return `<div class="commit"><div class="commit-information"><a href="${
    commit.web_url
  }" target="_blank">${escapeHtml(commit.title)}</a><span class="namespace-with-time">${timeSince(
    new Date(commit.committed_date),
  )} ago &middot; ${subline}</span></div>${logo}</div>`;
}

function renderNoCommitsPushedYetMessage() {
  executeUnsafeJavaScript('document.getElementById("commits-pagination").classList.add("hidden")');
  setElementHtml('#pipeline', '<p class="no-results">You haven&#039;t pushed any commits yet.</p>');
}

async function getCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("commits-pagination").classList.remove("hidden")',
  );
  executeUnsafeJavaScript('document.getElementById("commits-count").classList.remove("empty")');
  setElementHtml('#commits-count', `${index}/${recentCommits.length}`);
  const project = await callApi(`projects/${projectId}`);
  const commit = await callApi(`projects/${project.id}/repository/commits/${sha}`);
  if (project && commit) {
    setElementHtml('#pipeline', displayCommit(commit, project));
  }
}

async function getLastCommits(count = 20) {
  if (lastLastCommitsExecutionFinished && lastLastCommitsExecution + delay < Date.now()) {
    lastLastCommitsExecutionFinished = false;

    const commits = await callApi('events', {
      action: 'pushed',
      per_page: count,
    });
    if (commits && Array.isArray(commits) && !commits.error) {
      if (commits && commits.length > 0) {
        lastEventId = commits[0].id;
        getLastPipelines(commits);
        const committedArray = commits.filter(
          /* eslint-disable implicit-arrow-linebreak */
          (commit) =>
            commit.action_name === 'pushed to' ||
            (commit.action_name === 'pushed new' &&
              commit.push_data.commit_to &&
              commit.push_data.commit_count > 0),
          /* eslint-enable */
        );
        if (committedArray && committedArray.length > 0) {
          [currentCommit] = committedArray;
          recentCommits = committedArray;
          getCommitDetails(committedArray[0].project_id, committedArray[0].push_data.commit_to, 1);
        } else {
          renderNoCommitsPushedYetMessage();
        }
      } else {
        renderNoCommitsPushedYetMessage();
      }
    }
    lastLastCommitsExecution = Date.now();
    lastLastCommitsExecutionFinished = true;
  }
}

async function getRecentComments() {
  if (lastRecentCommentsExecutionFinished && lastRecentCommentsExecution + delay < Date.now()) {
    lastRecentCommentsExecutionFinished = false;
    let recentCommentsString = '';

    const comments = await callApi('events', {
      action: 'commented',
      per_page: numberOfRecentComments,
    });
    if (comments && Array.isArray(comments) && !comments.error) {
      if (comments && comments.length > 0) {
        recentCommentsString += '<ul class="list-container">';
        /* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop */
        for (const comment of comments) {
          const path = GitLab.commentToNoteableUrl(comment);

          if (!path) {
            continue;
          }

          const collabject = await callApi(path);
          if (collabject) {
            recentCommentsString += renderCollabject(comment, collabject);
          }
        }
        // eslint-disable no-restricted-syntax */
        const moreString = "'Comments'";
        recentCommentsString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
        setElementHtml('#comments', recentCommentsString);
      } else {
        setElementHtml(
          '#comments',
          '<p class="no-results">You haven&#039;t written any comments yet.</p>',
        );
      }
    }
    lastRecentCommentsExecution = Date.now();
    lastRecentCommentsExecutionFinished = true;
  }
}

async function getLastEvent() {
  if (!recentCommits || recentCommits.length === 0) {
    return;
  }
  const lastEvent = await callApi('events', {
    action: 'pushed',
    per_page: 1,
  });
  if (lastEvent && lastEvent.id !== lastEventId) {
    lastEventId = lastEvent.id;
    getLastCommits();
    getRecentComments();
  }
}

async function getLastTodo() {
  const todo = await callApi('todos', {
    per_page: 1,
  });
  if (todo && lastTodoId !== todo.id) {
    if (lastTodoId !== -1 && Date.parse(todo.created_at) > Date.now() - 20000) {
      const todoNotification = new Notification({
        title: todo.body,
        subtitle: todo.author.name,
        body: todo.target.title,
      });
      todoNotification.on('click', () => {
        shell.openExternal(todo.target_url);
      });
      todoNotification.show();
    }
    lastTodoId = todo.id;
  }
}

async function getUser() {
  if (lastUserExecutionFinished && lastUserExecution + delay < Date.now()) {
    lastUserExecutionFinished = false;

    const user = await callApi('user');
    if (user && !user.error) {
      let avatarUrl;
      if (user.avatar_url) {
        avatarUrl = new URL(user.avatar_url);
        if (avatarUrl.host !== 'secure.gravatar.com') {
          avatarUrl.href += '?width=64';
        }
      }
      const userHtml = `<a href="${user.web_url}" target="_blank"><img src="${
        avatarUrl.href
      }" /><div class="user-information"><span class="user-name">${escapeHtml(
        user.name,
      )}</span><span class="username">@${escapeHtml(user.username)}</span></div></a>`;
      setElementHtml('#user', userHtml);
      lastUserExecution = Date.now();
      lastUserExecutionFinished = true;
    }
  }
}

function tryRefresh() {
  if (!refreshInProgress) {
    refreshInProgress = true;
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        refresh_token: store.refresh_token,
        grant_type: 'refresh_token',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        if (result.access_token && result.refresh_token) {
          store.access_token = result.access_token;
          store.refresh_token = result.refresh_token;
          lastUserExecution = 0;
          lastLastCommitsExecution = 0;
          lastRecentCommentsExecution = 0;

          lastUserExecutionFinished = true;
          lastLastCommitsExecutionFinished = true;
          lastRecentCommentsExecutionFinished = true;

          getUser();
          getLastTodo();
          getLastCommits();
          getRecentComments();
        } else {
          logout();
        }
        refreshInProgress = false;
      })
      .catch(() => {
        refreshInProgress = false;
        logout();
      });
  }
}

async function saveUser(
  accessToken,
  url = store.host,
  customCertPath = undefined,
  refreshToken = undefined,
) {
  try {
    if (url.endsWith('/')) {
      /* eslint-disable no-param-reassign */
      url = url.substring(0, url.length - 1);
    }
    /* eslint-disable operator-linebreak, object-curly-newline */
    const options = customCertPath
      ? { access_token: accessToken, custom_cert_path: customCertPath }
      : { access_token: accessToken };
    /* eslint-enable */
    const result = await callApi('user', options, url);
    if (result && result.id && result.username) {
      store.access_token = accessToken;
      store.user_id = result.id;
      store.username = result.username;
      store.host = url;
      if (refreshToken) {
        store.refresh_token = refreshToken;
      }
      if (customCertPath) {
        store.custom_cert_path = customCertPath;
      }
      getUsersProjects().then(async (projects) => {
        if (
          store['favorite-projects'] &&
          store['favorite-projects'].length === 0 &&
          projects &&
          projects.length > 0
        ) {
          store['favorite-projects'] = projects;
        }
        // eslint-disable-next-line no-use-before-define
        mb.window.removeListener('page-title-updated', handleLogin);
        await mb.window
          .loadURL(`file://${__dirname}/index.html`)
          .then(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          })
          .catch(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          });
      });
    }
  } catch (e) {
    throw new Error(e);
  }
}

function handleLogin() {
  if (mb.window.webContents.getURL().indexOf('?code=') !== -1) {
    const code = mb.window.webContents.getURL().split('?code=')[1].replace('&state=test', '');
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
        code_verifier: verifier,
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        saveUser(result.access_token, 'https://gitlab.com', undefined, result.refresh_token);
      });
  }
}

async function startLogin() {
  verifier = base64URLEncode(nodeCrypto.randomBytes(32));
  challenge = base64URLEncode(sha256(verifier));
  await mb.window.loadURL(
    `${store.host}/oauth/authorize?client_id=2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee&redirect_uri=https://mvanremmerden.gitlab.io/gitdock-login/&response_type=code&state=test&scope=read_api&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  mb.window.on('page-title-updated', handleLogin);
  mb.showWindow();
}

async function getUsersPlan() {
  let userNamespace;
  const namespaces = await callApi('namespaces');
  if (namespaces && namespaces.length > 0) {
    userNamespace = namespaces.find((namespace) => namespace.kind === 'user');
  }

  store.plan = userNamespace && userNamespace.plan ? userNamespace.plan : 'free';
}

async function getProjectCommits(project, count = 20) {
  const commits = await callApi(`projects/${project.id}/repository/commits`, {
    per_page: count,
  });
  if (commits && commits.length > 0) {
    recentProjectCommits = commits;
    [currentProjectCommit] = commits;

    const commit = await callApi(`projects/${project.id}/repository/commits/${commits[0].id}`, {
      per_page: count,
    });
    if (commit) {
      const pagination = `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="project-commits-count">1/${recentProjectCommits.length}</span><button onclick="changeProjectCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeProjectCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`;
      setElementHtml('#detail-headline', pagination);
      setElementHtml('#project-pipeline', displayCommit(commit, project, 'author'));
    }
  } else {
    setElementHtml('#project-commits-pagination', '<span class="name">Commits</span>');
    setElementHtml('#project-pipeline', '<p class="no-results">No commits pushed yet.</p>');
  }
}

function changeCommit(forward, commitArray, chosenCommit) {
  let nextCommit;
  let index = commitArray.findIndex((commit) => commit.id === chosenCommit.id);
  if (forward) {
    if (index === commitArray.length - 1) {
      [nextCommit] = commitArray;
      index = 1;
    } else {
      nextCommit = commitArray[index + 1];
      index += 2;
    }
  } else if (index === 0) {
    nextCommit = commitArray[commitArray.length - 1];
    index = commitArray.length;
  } else {
    nextCommit = commitArray[index - 1];
  }
  nextCommit.index = index;
  return nextCommit;
}

async function getProjectCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("project-commits-count").classList.remove("empty")',
  );
  setElementHtml('#project-commits-count', `${index}/${recentProjectCommits.length}`);

  const commit = await callApi(`projects/${projectId}/repository/commits/${sha}`);
  if (commit) {
    setElementHtml('#project-pipeline', displayCommit(commit, currentProject, 'author'));
  }
}

async function getMoreRecentlyVisited() {
  recentlyVisitedString = '';
  let firstItem = true;
  await BrowserHistory.getAllHistory().then(async (history) => {
    const item = Array.prototype.concat.apply([], history);
    item.sort((a, b) => {
      if (a.utc_time > b.utc_time) {
        return -1;
      }
      if (b.utc_time > a.utc_time) {
        return 1;
      }
      return -1;
    });
    setElementHtml(
      '#detail-headline',
      '<input id="recentSearch" type="text" onkeyup="searchRecent(this)" placeholder="Search..." />',
    );

    let previousDate = 0;
    for (let j = 0; j < item.length; j += 1) {
      const { title } = item[j];
      let { url } = item[j];
      const isHostUrl = url.startsWith(`${store.host}/`);
      const isIssuable =
        url.includes('/-/issues/') ||
        url.includes('/-/merge_requests/') ||
        url.includes('/-/epics/');
      const wasNotProcessed = !moreRecentlyVisitedArray.some((object) => object.title === title);
      const ignoredTitlePrefixes = [
        'Not Found',
        'New Issue',
        'New Merge Request',
        'New merge request',
        'New Epic',
        'Edit',
        'Merge Conflicts',
        'Merge requests',
        'Issues',
        '500 Error - GitLab',
        'Checking your Browser - GitLab',
      ];
      const titlePrefix = (title || '').split('·')[0].trim();
      if (
        title &&
        isHostUrl &&
        isIssuable &&
        wasNotProcessed &&
        !ignoredTitlePrefixes.includes(titlePrefix)
      ) {
        const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
        if (nameWithNamespace.split('/')[0] !== 'groups') {
          url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
            nameWithNamespace.split('/')[1]
          }?access_token=${store.access_token}`;
        } else {
          url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
            store.access_token
          }`;
        }
        const currentDate = new Date(item[j].utc_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: timezone,
        });
        if (previousDate !== currentDate) {
          if (
            currentDate ===
            new Date(Date.now()).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              timeZone: timezone,
            })
          ) {
            recentlyVisitedString += '<div class="date">Today</div>';
          } else {
            if (!firstItem) {
              recentlyVisitedString += '</ul>';
            }
            recentlyVisitedString += `<div class="date">${currentDate}</div>`;
          }
          recentlyVisitedString += '<ul class="list-container history-list-container">';
          previousDate = currentDate;
        }
        moreRecentlyVisitedArray.push(item[j]);
        recentlyVisitedString += '<li class="history-entry">';
        recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
          item[j].title.split('·')[0],
        )}</a><span class="namespace-with-time">${timeSince(
          new Date(`${item[j].utc_time} UTC`),
        )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
          item[j].title.split('·')[2].trim(),
        )}</a></span></div></li>`;
        firstItem = false;
      }
    }
    recentlyVisitedString += '</ul>';
    setElementHtml('#detail-content', recentlyVisitedString);
  });
}

function searchRecentlyVisited(searchterm) {
  /* eslint-disable implicit-arrow-linebreak, function-paren-newline */
  const foundArray = moreRecentlyVisitedArray.filter((item) =>
    item.title.toLowerCase().includes(searchterm),
  );
  /* eslint-enable */
  let foundString = '<ul class="list-container">';
  foundArray.forEach((item) => {
    const object = item;
    const nameWithNamespace = object.url.replace(`${store.host}/`, '').split('/-/')[0];
    if (nameWithNamespace.split('/')[0] !== 'groups') {
      object.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
        nameWithNamespace.split('/')[1]
      }?access_token=${store.access_token}`;
    } else {
      object.url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
        store.access_token
      }`;
    }
    foundString += '<li class="history-entry">';
    foundString += `<a href="${object.url}" target="_blank">${escapeHtml(
      object.title.split('·')[0],
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(`${object.utc_time} UTC`),
    )} ago &middot; <a href="${object.url.split('/-/')[0]}" target="_blank">${escapeHtml(
      object.title.split('·')[2].trim(),
    )}</a></span></div></li>`;
  });
  foundString += '</ul>';
  setElementHtml('#detail-content', foundString);
}

function getMoreRecentComments(
  url = `${store.host}/api/v4/events?action=commented&per_page=${numberOfComments}&access_token=${store.access_token}`,
) {
  let recentCommentsString = '<ul class="list-container">';
  const type = "'Comments'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then(async (comments) => {
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const comment of comments) {
        const path = GitLab.commentToNoteableUrl(comment);
        const collabject = await callApi(path);
        if (collabject) {
          recentCommentsString += renderCollabject(comment, collabject);
        }
      }
      /* eslint-enable */
      recentCommentsString += `</ul>${displayPagination(keysetLinks, type)}`;
      setElementHtml('#detail-content', recentCommentsString);
    });
}

function getIssues(
  url = `${store.host}/api/v4/issues?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let issuesString = '';
  const type = "'Issues'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((issues) => {
      if (issues && issues.length > 0) {
        issuesString += '<ul class="list-container">';
        issues.forEach((issue) => {
          let timestamp;
          if (activeIssuesSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(issue.updated_at))} ago`;
          } else if (activeIssuesSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(issue.created_at))} ago`;
          } else if (activeIssuesSortOption === 'due_date&sort=asc') {
            if (!issue.due_date) {
              timestamp = 'No due date';
            } else if (new Date() > new Date(issue.due_date)) {
              timestamp = `Due ${timeSince(new Date(issue.due_date))} ago`;
            } else {
              timestamp = `Due in ${timeSince(new Date(issue.due_date), 'to')}`;
            }
          }
          issuesString += '<li class="history-entry">';
          issuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
            issue.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            issue.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(
            issue.references.full.split('#')[0],
          )}</a></span></div></li>`;
        });
        issuesString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        issuesString = `<div class="zero">${illustration}<p>No issues with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, issuesString);
    });
}

function getMRs(
  url = `${store.host}/api/v4/merge_requests?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let mrsString = '';
  const type = "'MRs'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((mrs) => {
      if (mrs && mrs.length > 0) {
        mrsString = '<ul class="list-container">';
        mrs.forEach((mr) => {
          let timestamp;
          if (activeMRsSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(mr.updated_at))} ago`;
          } else if (activeMRsSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(mr.created_at))} ago`;
          }
          mrsString += '<li class="history-entry">';
          mrsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
            mr.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            mr.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(mr.references.full.split('!')[0])}</a></span></div></li>`;
        });
        mrsString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        mrsString = `<div class="zero">${illustration}<p>No merge requests with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, mrsString);
    });
}

function getTodos(
  url = `${store.host}/api/v4/todos?per_page=${numberOfTodos}&access_token=${store.access_token}`,
) {
  let todosString = '';
  const type = "'Todos'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((todos) => {
      if (todos && todos.length > 0) {
        todosString = '<ul class="list-container">';
        todos.forEach((todo) => {
          const item = todo;
          todosString += '<li class="history-entry">';
          let location = '';
          if (item.project) {
            location = item.project.name_with_namespace;
          } else if (item.group) {
            location = item.group.name;
          }
          if (item.target_type === 'DesignManagement::Design') {
            item.target.title = item.body;
          }
          todosString += `<a href="${item.target_url}" target="_blank">${escapeHtml(
            item.target.title,
          )}</a><span class="namespace-with-time">Updated ${timeSince(
            new Date(item.updated_at),
          )} ago &middot; <a href="${item.target_url.split('/-/')[0]}" target="_blank">${escapeHtml(
            location,
          )}</a></span></div></li>`;
        });
        todosString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        todosString = `<div class="zero">${illustration}<p>Take the day off, you have no To-Dos!</p></div>`;
      }
      setElementHtml('#detail-content', todosString);
    });
}

function setupEmptyProjectPage() {
  let emptyPage =
    '<div id="project-pipeline"><div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div></div><div id="project-name"></div></div>';
  emptyPage += '<div class="headline"><span class="name">Issues</span></div>';
  emptyPage +=
    '<div id="project-recent-issues"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  emptyPage += '<div class="headline"><span class="name">Merge requests</span></div>';
  emptyPage +=
    '<div id="project-recent-mrs"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  setElementHtml('#detail-content', emptyPage);
}

function displayProjectPage(project) {
  let logo;
  if (project.avatar_url && project.avatar_url != null && project.visibility === 'public') {
    logo = `<img id="project-detail-avatar" src="${project.avatar_url}?width=64" />`;
  } else {
    logo = `<div id="project-detail-name-avatar">${project.name.charAt(0).toUpperCase()}</div>`;
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml(
    '#detail-header-content',
    `<div id="project-detail-information">
        ${logo}
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-namespace">
          ${escapeHtml(project.namespace.name)}
        </span>
      </div>
      <div class="detail-external-link">
        <a href="${escapeHtml(project.web_url)}" target="_blank">${externalLinkIcon}</a>
      </div>`,
  );
}

async function getProjectIssues(project) {
  let projectIssuesString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const issuesString = "'Issues'";

  const issues = await callApi(`projects/${project.id}/issues`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (issues && issues.length > 0) {
    projectIssuesString = '<ul class="list-container">';
    issues.forEach((issue) => {
      projectIssuesString += '<li class="history-entry">';
      projectIssuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
        issue.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(issue.created_at),
      )} ago &middot; ${escapeHtml(issue.author.name)}</span></div></li>`;
    });
    projectIssuesString += `<li class="more-link"><a onclick="goToSubDetail(${issuesString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectIssuesString += '</ul>';
  } else {
    projectIssuesString = '<p class="no-results with-all-link">No open issues.</p>';
    projectIssuesString += `<div class="all-link"><a onclick="goToSubDetail(${issuesString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-issues', projectIssuesString);
}

async function getProjectMRs(project) {
  let projectMRsString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const mrsString = "'Merge Requests'";

  const mrs = await callApi(`projects/${project.id}/merge_requests`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (mrs && mrs.length > 0) {
    projectMRsString += '<ul class="list-container">';
    mrs.forEach((mr) => {
      projectMRsString += '<li class="history-entry">';
      projectMRsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
        mr.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(mr.created_at),
      )} ago &middot; ${escapeHtml(mr.author.name)}</span></div></li>`;
    });
    projectMRsString += `<li class="more-link"><a onclick="goToSubDetail(${mrsString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectMRsString += '</ul>';
  } else {
    projectMRsString = '<p class="no-results with-all-link">No open merge requests.</p>';
    projectMRsString += `<div class="all-link"><a onclick="goToSubDetail(${mrsString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-mrs', projectMRsString);
}

function addBookmark(link) {
  if (store && store.bookmarks && store.bookmarks.length > 0) {
    const sameBookmarks = store.bookmarks.filter((item) => item.web_url === link);
    if (sameBookmarks.length > 0) {
      displayAddError('bookmark', '-', 'This bookmark has already been added.');
      return;
    }
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("bookmark-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").disabled = "disabled"');
  setElementHtml('#bookmark-add-button', `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then((bookmark) => {
        const allowedTypes = [
          'issues',
          'merge_requests',
          'epics',
          'projects',
          'groups',
          'boards',
          'users',
          'unknown',
        ];

        if (allowedTypes.includes(bookmark.type)) {
          const bookmarks = store.bookmarks || [];
          bookmarks.push(bookmark);
          store.bookmarks = bookmarks;
          getBookmarks();
        } else {
          displayAddError('bookmark', '-');
        }
      })
      .catch(() => {
        displayAddError('bookmark', '-');
      });
  } else {
    displayAddError('bookmark', '-');
  }
}

function addProject(link, target) {
  let newTarget = target;
  if (newTarget === 'project-settings-link') {
    newTarget = '-settings-';
  } else if (newTarget === 'project-overview-link') {
    newTarget = '-overview-';
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}add-button").disabled = "disabled"`,
  );
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}link").disabled = "disabled"`,
  );
  setElementHtml(`#project${newTarget}add-button`, `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then(async (object) => {
        if (
          !store['favorite-projects'] ||
          !store['favorite-projects'].filter((project) => project.web_url === object.web_url).length
        ) {
          if (object.type && object.type !== 'projects') {
            const projectWithNamespace = encodeURIComponent(
              link.split(`${store.host}/`)[1],
            ).replace(/%2F$/, '');
            const project = await callApi(`projects/${projectWithNamespace}`);
            const projects = store['favorite-projects'] || [];
            projects.push({
              id: project.id,
              visibility: project.visibility,
              web_url: project.web_url,
              name: project.name,
              title: project.name,
              namespace: {
                name: project.namespace.name,
              },
              parent_name: project.name_with_namespace,
              parent_url: project.namespace.web_url,
              name_with_namespace: project.name_with_namespace,
              open_issues_count: project.open_issues_count,
              last_activity_at: project.last_activity_at,
              avatar_url: project.avatar_url,
              star_count: project.star_count,
              forks_count: project.forks_count,
            });
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          } else {
            const projects = store['favorite-projects'] || [];
            projects.push(object);
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          }
        } else {
          displayAddError('project', newTarget, 'The same project was already added.');
        }
      })
      .catch(() => {
        displayAddError('project', newTarget);
      });
  } else {
    displayAddError('project', newTarget);
  }
}

function addShortcut(link) {
  const tempArray = [link];
  store.shortcuts = store.shortcuts.concat(tempArray);
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("shortcut-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").disabled = "disabled"');
  setElementHtml('#shortcut-add-button', `${spinner} Add`);
  setupCommandPalette();
  repaintShortcuts();
}

function startBookmarkDialog() {
  const bookmarkLink = "'bookmark-link'";
  const bookmarkInput = `<form action="#" id="bookmark-input" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter your link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-bookmark-dialog").classList.add("opened")');
  setElementHtml('#add-bookmark-dialog', bookmarkInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").focus()');
}

function startProjectDialog() {
  const projectLink = "'project-settings-link'";
  const projectInput = `<form action="#" class="project-input" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-settings-link" placeholder="Enter the link to the project here..." /><button class="add-button" id="project-settings-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-settings-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-project-dialog").classList.add("opened")');
  setElementHtml('#add-project-dialog', projectInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("project-settings-link").focus()');
}

function startShortcutDialog() {
  const shortcutLink = "'shortcut-link'";
  const shortcutInput = `<form action="#" class="shortcut-input" onsubmit="addShortcut(document.getElementById(${shortcutLink}).value);return false;"><input class="shortcut-link" id="shortcut-link" placeholder="Enter the keyboard shortcut here..." /><button class="add-button" id="shortcut-add-button" type="submit">Add</button></form><div class="add-shortcut-error" id="add-shortcut-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-shortcut-dialog").classList.add("opened")');
  setElementHtml('#add-shortcut-dialog', shortcutInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").focus()');
}

function displaySkeleton(count, pagination = false, id = 'detail-content') {
  let skeletonString = '<ul class="list-container empty';
  if (pagination) {
    skeletonString += ' with-pagination">';
  } else {
    skeletonString += '">';
  }
  for (let i = 0; i < count; i += 1) {
    skeletonString +=
      '<li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li>';
  }
  skeletonString += '</ul>';
  setElementHtml(`#${id}`, skeletonString);
}

function changeTheme(option = 'light', manual = false) {
  store.theme = option;
  if (option === 'light') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "light");');
  } else if (option === 'dark') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "dark");');
  }
  if (manual) {
    executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
    executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
    executeUnsafeJavaScript(`document.getElementById("${option}-mode").classList.add("active")`);
  }
}

mb.on('ready', () => {
  setupContextMenu();
  setupCommandPalette();

  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (store.analytics) {
      visitor.event('Visit external link', true).send();
    }
    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });
});

if (store.access_token && store.user_id && store.username) {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();

    mb.showWindow();
    changeTheme(store.theme, false);

    // Preloading content
    getUser();
    getLastTodo();
    getUsersPlan();
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();

    // Regularly relaoading content
    setInterval(() => {
      getLastEvent();
      getLastTodo();
    }, 10000);
  });

  mb.on('show', () => {
    if (store.analytics) {
      visitor.pageview('/').send();
    }
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();
  });
} else {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();
    mb.window.loadURL(`file://${__dirname}/login.html`).then(() => {
      changeTheme(store.theme, false);
      mb.showWindow();
    });
  });
}

ipcMain.on('detail-page', (event, arg) => {
  setElementHtml('#detail-headline', '');
  setElementHtml('#detail-content', '');
  if (arg.page === 'Project') {
    if (store.analytics) {
      visitor.pageview('/project').send();
    }
    setElementHtml(
      '#detail-headline',
      `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="commits-count" class="empty"></span><button onclick="changeCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`,
    );
    setupEmptyProjectPage();
    const project = JSON.parse(arg.object);
    currentProject = project;
    displayProjectPage(project);
    getProjectCommits(project);
    getProjectIssues(project);
    getProjectMRs(project);
  } else {
    executeUnsafeJavaScript(
      'document.getElementById("detail-header-content").classList.remove("empty")',
    );
    setElementHtml('#detail-header-content', arg.page);
    if (arg.page === 'Issues') {
      if (store.analytics) {
        visitor.pageview('/my-issues').send();
      }
      const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
      const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
          <div class="filter-sort">
            ${issuesQuerySelect}
            ${issuesStateSelect}
            ${issuesSortSelect}
          </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfIssues);
      getIssues();
    } else if (arg.page === 'Merge requests') {
      if (store.analytics) {
        visitor.pageview('/my-merge-requests').send();
      }
      let mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label>`;
      if (store.plan !== 'free') {
        mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label>`;
      }
      mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
      const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfMRs);
      getMRs();
    } else if (arg.page === 'To-Do list') {
      if (store.analytics) {
        visitor.pageview('/my-to-do-list').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      setElementHtml(
        '#detail-header-content',
        `${arg.page}<div class="detail-external-link">
        <a href="${escapeHtml(store.host)}/dashboard/todos" target="_blank">
          ${externalLinkIcon}
        </a>
        </div>`,
      );
      displaySkeleton(numberOfTodos);
      getTodos();
    } else if (arg.page === 'Recently viewed') {
      if (store.analytics) {
        visitor.pageview('/my-history').send();
      }
      displaySkeleton(numberOfRecentlyVisited);
      getMoreRecentlyVisited();
    } else if (arg.page === 'Comments') {
      if (store.analytics) {
        visitor.pageview('/my-comments').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      displaySkeleton(numberOfComments);
      getMoreRecentComments();
    }
  }
});

ipcMain.on('sub-detail-page', (event, arg) => {
  isOnSubPage = true;
  activeIssuesQueryOption = 'all';
  activeMRsQueryOption = 'all';
  let activeState = 'Open';
  let allChecked = '';
  let openChecked = ' checked';
  let allChanged = '';
  const project = JSON.parse(arg.project);
  setElementHtml('#sub-detail-headline', '');
  setElementHtml('#sub-detail-content', '');
  executeUnsafeJavaScript(
    'document.getElementById("sub-detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#sub-detail-header-content', arg.page);
  if (arg.page === 'Issues') {
    if (store.analytics) {
      visitor.pageview('/project/issues').send();
    }
    if (arg.all === true) {
      activeIssuesStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
    const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="issues-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}-issues" onchange="switchIssues(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-issues" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${issuesQuerySelect}
          ${issuesStateSelect}
          ${issuesSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfIssues, undefined, 'sub-detail-content');
    getIssues(
      `${store.host}/api/v4/projects/${project.id}/issues?scope=all&state=${activeIssuesStateOption}&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  } else if (arg.page === 'Merge Requests') {
    if (store.analytics) {
      visitor.pageview('/project/merge-requests').send();
    }
    if (arg.all === true) {
      activeMRsStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
    const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="mrs-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}-state" onchange="switchMRs(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-state" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})"><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})" checked><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfMRs, undefined, 'sub-detail-content');
    getMRs(
      `${store.host}/api/v4/projects/${project.id}/merge_requests?scope=all&state=${activeMRsStateOption}&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  }
});

ipcMain.on('back-to-detail-page', () => {
  isOnSubPage = false;
  activeIssuesQueryOption = 'assigned_to_me';
  activeMRsQueryOption = 'assigned_to_me';
});

ipcMain.on('go-to-overview', () => {
  if (store.analytics) {
    visitor.pageview('/').send();
  }
  getRecentlyVisited();
  getRecentComments();
  displayUsersProjects();
  getBookmarks();
  executeUnsafeJavaScript(
    'document.getElementById("detail-headline").classList.remove("with-overflow")',
  );
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.add("empty")',
  );
  setElementHtml('#detail-header-content', '');
  activeIssuesQueryOption = 'assigned_to_me';
  activeIssuesStateOption = 'opened';
  activeIssuesSortOption = 'created_at';
  activeMRsQueryOption = 'assigned_to_me';
  activeMRsStateOption = 'opened';
  activeMRsSortOption = 'created_at';
  moreRecentlyVisitedArray = [];
  recentProjectCommits = [];
  currentProjectCommit = null;
  currentProject = null;
});

ipcMain.on('go-to-settings', () => {
  openSettingsPage();
});

ipcMain.on('switch-issues', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch issues', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeIssuesQueryOption) {
    activeIssuesQueryOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-query-active', arg.text);
    if (
      (isOnSubPage === false && arg.label !== 'assigned_to_me') ||
      (isOnSubPage === true && arg.label !== 'all')
    ) {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'state' && arg.label !== activeIssuesStateOption) {
    activeIssuesStateOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeIssuesSortOption) {
    activeIssuesSortOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.remove("changed")',
      );
    }
  }
  url += `issues?scope=${activeIssuesQueryOption}&state=${activeIssuesStateOption}&order_by=${activeIssuesSortOption}&per_page=${numberOfIssues}&access_token=${store.access_token}`;
  getIssues(url, id);
});

ipcMain.on('switch-mrs', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch merge requests', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeMRsQueryOption) {
    activeMRsQueryOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-query-active', arg.text);
    if (arg.label !== 'all') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.remove("changed")',
      );
    }
  }
  if (arg.type === 'state' && arg.label !== activeMRsStateOption) {
    activeMRsStateOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeMRsSortOption) {
    activeMRsSortOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.remove("changed")',
      );
    }
  }
  url += 'merge_requests?scope=';
  if (activeMRsQueryOption === 'assigned_to_me' || activeMRsQueryOption === 'created_by_me') {
    url += activeMRsQueryOption;
  } else if (activeMRsQueryOption === 'approved_by_me') {
    url += `all&approved_by_ids[]=${store.user_id}`;
  } else if (activeMRsQueryOption === 'review_requests_for_me') {
    url += `all&reviewer_id=${store.user_id}`;
  } else if (activeMRsQueryOption === 'approval_rule_for_me') {
    url += `all&approver_ids[]=${store.user_id}`;
  }
  url += `&state=${activeMRsStateOption}&order_by=${activeMRsSortOption}&per_page=${numberOfMRs}&access_token=${store.access_token}`;
  getMRs(url, id);
});

ipcMain.on('switch-page', (event, arg) => {
  let id;
  if (isOnSubPage) {
    id = 'sub-detail-content';
  } else {
    id = 'detail-content';
  }
  if (arg.type === 'Todos') {
    displaySkeleton(numberOfTodos, true);
    getTodos(arg.url);
  } else if (arg.type === 'Issues') {
    displaySkeleton(numberOfIssues, true, id);
    getIssues(arg.url, id);
  } else if (arg.type === 'MRs') {
    displaySkeleton(numberOfMRs, true, id);
    getMRs(arg.url, id);
  } else if (arg.type === 'Comments') {
    displaySkeleton(numberOfComments, true);
    getMoreRecentComments(arg.url);
  }
});

ipcMain.on('search-recent', (event, arg) => {
  setElementHtml('#detail-content', '');
  searchRecentlyVisited(arg);
});

ipcMain.on('change-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate my commits', 'next').send();
    } else {
      visitor.event('Navigate my commits', 'previous').send();
    }
  }
  setElementHtml(
    '#pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentCommits, currentCommit);
  currentCommit = nextCommit;
  getCommitDetails(nextCommit.project_id, nextCommit.push_data.commit_to, nextCommit.index);
});

ipcMain.on('change-project-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate project commits', 'next').send();
    } else {
      visitor.event('Navigate project commits', 'previous').send();
    }
  }
  setElementHtml(
    '#project-pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentProjectCommits, currentProjectCommit);
  currentProjectCommit = nextCommit;
  getProjectCommitDetails(currentProject.id, nextCommit.id, nextCommit.index);
});

ipcMain.on('add-bookmark', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add bookmark').send();
  }
  addBookmark(arg);
});

ipcMain.on('add-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add project').send();
  }
  addProject(arg.input, arg.target);
});

ipcMain.on('add-shortcut', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add shortcut').send();
  }
  addShortcut(arg);
});

ipcMain.on('start-bookmark-dialog', () => {
  startBookmarkDialog();
});

ipcMain.on('start-project-dialog', () => {
  startProjectDialog();
});

ipcMain.on('start-shortcut-dialog', () => {
  startShortcutDialog();
});

ipcMain.on('delete-bookmark', (event, hashedUrl) => {
  if (store.analytics) {
    visitor.event('Delete bookmark').send();
  }
  if (store.bookmarks && store.bookmarks.length > 0) {
    const newBookmarks = store.bookmarks.filter(
      (bookmark) => sha256hex(bookmark.web_url) !== hashedUrl,
    );
    store.bookmarks = newBookmarks;
  }
  getBookmarks();
});

ipcMain.on('delete-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Delete project').send();
  }
  const projects = store['favorite-projects'];
  const newProjects = projects.filter((project) => project.id !== arg);
  store['favorite-projects'] = newProjects;
  // TODO Implement better way to refresh view after deleting project
  displayUsersProjects();
  openSettingsPage();
});

ipcMain.on('delete-shortcut', (event, arg) => {
  store.shortcuts = store.shortcuts.filter((keys) => keys !== arg);
  setupCommandPalette();
  repaintShortcuts();
});

ipcMain.on('change-theme', (event, arg) => {
  if (store.analytics) {
    visitor.event('Change theme', arg).send();
  }
  changeTheme(arg, true);
});

ipcMain.on('change-analytics', (event, arg) => {
  store.analytics = arg;
  if (store.analytics) {
    visitor = ua('UA-203420427-1', store.analytics_id);
  } else {
    visitor = null;
  }
});

ipcMain.on('change-keep-visible', (event, arg) => {
  store.keep_visible = arg;
  mb.window.setAlwaysOnTop(arg);
});

ipcMain.on('change-show-dock-icon', (event, arg) => {
  mb.window.setAlwaysOnTop(true);
  store.show_dock_icon = arg;
  if (arg) {
    app.dock.show().then(() => {
      mb.window.setAlwaysOnTop(store.keep_visible);
    });
  } else {
    app.dock.hide();
    app.focus({
      steal: true,
    });
    setTimeout(() => {
      app.focus({
        steal: true,
      });
      mb.window.setAlwaysOnTop(store.keep_visible);
    }, 200);
  }
});

ipcMain.on('choose-certificate', () => {
  chooseCertificate();
});

ipcMain.on('reset-certificate', () => {
  executeUnsafeJavaScript('document.getElementById("custom-cert-path-text").innerText=""');
  executeUnsafeJavaScript(
    'document.getElementById("custom-cert-path-text").classList.add("hidden")',
  );
  chooseCertificate();
});

ipcMain.on('start-login', () => {
  startLogin();
});

ipcMain.on('start-manual-login', (event, arg) => {
  if (arg.custom_cert_path) {
    saveUser(arg.access_token, arg.host, arg.custom_cert_path);
  } else {
    saveUser(arg.access_token, arg.host);
  }
});

ipcMain.on('logout', () => {
  if (store.analytics) {
    visitor.event('Log out', true).send();
  }
  logout();
});

/* eslint-env es2021 */
const { menubar } = require('menubar');
const { Menu, Notification, shell, ipcMain, dialog, app } = require('electron');
const { URL } = require('url');
const ua = require('universal-analytics');
const jsdom = require('jsdom');
const nodeCrypto = require('crypto');
const { escapeHtml, escapeQuotes, escapeSingleQuotes, sha256hex } = require('./lib/util');
const GitLab = require('./lib/gitlab');
const {
  chevronLgLeftIcon,
  chevronLgLeftIconWithViewboxHack,
  chevronLgRightIcon,
  chevronLgRightIconWithViewboxHack,
  chevronRightIcon,
  externalLinkIcon,
  projectIcon,
  removeIcon,
  todosAllDoneIllustration,
} = require('./src/icons');
const {
  allLabel,
  allText,
  approvalLabel,
  approvalText,
  approvedLabel,
  approvedText,
  assignedLabel,
  assignedText,
  closedLabel,
  closedText,
  createdLabel,
  createdText,
  dueDateLabel,
  dueDateText,
  mergedLabel,
  mergedText,
  openedLabel,
  openedText,
  query,
  recentlyCreatedLabel,
  recentlyCreatedText,
  recentlyUpdatedLabel,
  recentlyUpdatedText,
  reviewedLabel,
  reviewedText,
  sort,
  state,
} = require('./src/filter-text');
const { store, deleteFromStore } = require('./lib/store');
const BrowserHistory = require('./lib/browser-history');
const processInfo = require('./lib/process-info');
const { version } = require('./package.json');
const CommandPalette = require('./src/command-palette');
// eslint-disable-next-line no-shadow
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { JSDOM } = jsdom;
let commandPalette;
global.DOMParser = new JSDOM().window.DOMParser;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let visitor;
if (store.analytics) {
  visitor = ua('UA-203420427-1', store.analytics_id);
}
let recentlyVisitedString = '';
let currentProject;
let moreRecentlyVisitedArray = [];
let recentCommits = [];
let currentCommit;
let lastEventId;
let lastTodoId = -1;
let recentProjectCommits = [];
let currentProjectCommit;
const numberOfRecentlyVisited = 3;
const numberOfFavoriteProjects = 5;
const numberOfRecentComments = 3;
const numberOfIssues = 10;
const numberOfMRs = 10;
const numberOfTodos = 10;
const numberOfComments = 5;
let activeIssuesQueryOption = 'assigned_to_me';
let activeIssuesStateOption = 'opened';
let activeIssuesSortOption = 'created_at';
let activeMRsQueryOption = 'assigned_to_me';
let activeMRsStateOption = 'opened';
let activeMRsSortOption = 'created_at';
let runningPipelineSubscriptions = [];
let runningPipelineSubscriptionInterval = -1;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let isOnSubPage = false;

// Anti rebound variables
const delay = 2000;
let lastUserExecution = 0;
let lastRecentlyVisitedExecution = 0;
let lastLastCommitsExecution = 0;
let lastRecentCommentsExecution = 0;

let lastUserExecutionFinished = true;
let lastRecentlyVisitedExecutionFinished = true;
let lastLastCommitsExecutionFinished = true;
let lastRecentCommentsExecutionFinished = true;

let refreshInProgress = false;

let verifier = '';
let challenge = '';

const mb = menubar({
  showDockIcon: store.show_dock_icon,
  showOnAllWorkspaces: false,
  icon: `${__dirname}/assets/gitlabTemplate.png`,
  preloadWindow: true,
  browserWindow: {
    width: 550,
    height: 700,
    minWidth: 265,
    minHeight: 300,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      nodeIntegration: process.env.NODE_ENV === 'test',
      contextIsolation: process.env.NODE_ENV !== 'test',
      enableRemoteModule: process.env.NODE_ENV === 'test',
    },
    alwaysOnTop: store.keep_visible,
  },
});

const executeUnsafeJavaScript = (js) => mb.window.webContents.executeJavaScript(js);

const setElementHtml = (selector, html) =>
  // This is caused by a Pretter/eslint mismatch
  // eslint-disable-next-line implicit-arrow-linebreak
  executeUnsafeJavaScript(
    `document.querySelector("${escapeQuotes(selector)}").innerHTML = "${escapeQuotes(html).replace(
      /\n/g,
      '\\n',
    )}"`,
  );

// eslint-disable-next-line object-curly-newline
async function callApi(what, options = {}, host = store.host) {
  return new Promise((resolve, reject) => {
    GitLab.get(what, options, host)
      .then((result) => {
        if (result && result.error) {
          // eslint-disable-next-line no-use-before-define
          tryRefresh();
        }
        resolve(result);
      })
      .catch(() => {
        reject();
      });
  });
}

function openSettingsPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/settings').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'Settings');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  const lightString = "'light'";
  const darkString = "'dark'";
  setElementHtml('#detail-headline', '<span class="name">Theme</span>');
  let settingsString = '';
  const theme = `<div id="theme-selection"><div id="light-mode" class="theme-option" onclick="changeTheme(${lightString})"><div class="indicator"></div>Light</div><div id="dark-mode" class="theme-option" onclick="changeTheme(${darkString})"><div class="indicator"></div>Dark</div></div>`;
  if (store.user_id && store.username) {
    const projects = store['favorite-projects'];
    let favoriteProjects =
      '<div class="headline"><span class="name">Favorite projects</span></div><div id="favorite-projects"><ul class="list-container">';
    if (projects && projects.length > 0) {
      projects.forEach((project) => {
        favoriteProjects += `<li>${projectIcon}<div class="name-with-namespace"><span>${escapeHtml(
          project.name,
        )}</span><span class="namespace">${escapeHtml(project.namespace.name)}</span></div>`;
        favoriteProjects += `<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteProject(${project.id})">${removeIcon}</div></div></li>`;
      });
    }
    favoriteProjects += `<li id="add-project-dialog" class="more-link"><a onclick="startProjectDialog()">Add another project ${chevronRightIcon}</a></li></ul></div>`;
    let preferences =
      '<div class="headline"><span class="name">Preferences</span></div><div id="preferences"><form id="prerefences-form">';
    preferences += '<div><input type="checkbox" id="keep-visible" name="keep-visible" ';
    if (store.keep_visible) {
      preferences += ' checked="checked"';
    }
    preferences +=
      'onchange="changeKeepVisible(this.checked)"/><label for="keep-visible">Keep GitDock visible, even when losing focus.</label></div>';
    if (processInfo.platform === 'darwin') {
      preferences += '<div><input type="checkbox" id="show-dock-icon" name="show-dock-icon" ';
      if (store.show_dock_icon) {
        preferences += ' checked="checked"';
      }
      preferences +=
        'onchange="changeShowDockIcon(this.checked)"/><label for="show-dock-icon">Show icon also in dock, not only in menubar.</label></div>';
    }
    preferences += '</form></div>';
    let shortcut =
      '<div class="headline"><span class="name">Command Palette shortcuts</span></div><div id="shortcut"><p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p>';
    if (store.shortcuts) {
      shortcut += '<ul class="list-container">';
      store.shortcuts.forEach((keys) => {
        shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
      });
      shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
    }
    shortcut += '</div>';
    let analyticsString =
      '<div class="headline"><span class="name">Analytics</span></div><div id="analytics">';
    analyticsString +=
      'To better understand how you make use of GitDock features to navigate around your issues, MRs, and other areas, we would love to collect insights about your usage. All data is 100% anonymous and we do not track the specific content (projects, issues...) you are interacting with, only which kind of areas you are using.</div>';
    analyticsString += `<form id="analytics-form"><div><input type="radio" id="analytics-yes" name="analytics" value="yes"${
      store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(true)"><label for="analytics-yes">Yes, collect anonymous data.</label></div><div><input type="radio" id="analytics-no" name="analytics" value="no"${
      !store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(false)"><label for="analytics-no">No, do not collect any data.</label></div></form>`;
    const signout =
      '<div class="headline"><span class="name">User</span></div><div id="user-administration"><button id="logout-button" onclick="logout()">Log out</button></div>';
    settingsString = theme + favoriteProjects + preferences + shortcut + analyticsString + signout;
  } else {
    settingsString = theme;
  }
  setElementHtml('#detail-content', `${settingsString}</div>`);
  executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
  executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
  executeUnsafeJavaScript(`document.getElementById("${store.theme}-mode").classList.add("active")`);
}

function openAboutPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/about').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'About GitDock ⚓️');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  setElementHtml('#detail-headline', '<span class="name">About GitDock ⚓️</span>');
  let aboutString =
    '<p>GitDock is a MacOS/Windows/Linux app that displays all your GitLab activities in one place. Instead of the GitLab typical project- or group-centric approach, it collects all your information from a user-centric perspective.</p>';
  aboutString +=
    '<p>If you want to learn more about why we built this app, you can have a look at our <a href="https://about.gitlab.com/blog/2021/10/05/gitpod-desktop-app-personal-activities" target="_blank">blog post</a>.</p>';
  aboutString +=
    '<p>We use issues to collect bugs, feature requests, and more. You can <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues" target="_blank">browse through existing issues</a>. To report a bug, suggest an improvement, or propose a feature, please <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues/new">create a new issue</a> if there is not already an issue for it.</p>';
  aboutString +=
    '<p>If you are thinking about contributing directly, check out our <a href="https://gitlab.com/mvanremmerden/gitdock/-/blob/main/CONTRIBUTING.md" target="_blank">contribution guidelines</a>.</p>';
  aboutString += `<p class="version-number">Version ${version}</p>`;
  setElementHtml('#detail-content', `${aboutString}</div>`);
}

function setupLinuxContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GitDock',
      click: () => mb.showWindow(),
      visible: processInfo.platform === 'linux',
    },
    ...baseMenuItems,
  ]);

  mb.tray.setContextMenu(menu);
}

function setupGenericContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate(baseMenuItems);

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(menu);
  });
}

function setupContextMenu() {
  const baseMenuItems = [
    {
      label: 'Settings',
      click: () => {
        openSettingsPage();
      },
    },
    {
      label: 'About',
      click: () => {
        openAboutPage();
      },
    },
    {
      label: 'Quit',
      click: () => {
        mb.app.quit();
      },
    },
  ];

  if (processInfo.platform === 'linux') {
    setupLinuxContextMenu(baseMenuItems);
  } else {
    setupGenericContextMenu(baseMenuItems);
  }
}

function setupCommandPalette() {
  if (!commandPalette) {
    commandPalette = new CommandPalette();
  }

  commandPalette.register({
    shortcut: store.shortcuts,
  });
}

function chooseCertificate() {
  mb.window.setAlwaysOnTop(true);
  const filepaths = dialog.showOpenDialogSync();
  setTimeout(() => {
    mb.window.setAlwaysOnTop(false);
  }, 200);
  if (filepaths) {
    const filepath = filepaths[0].replace(/\\/g, '/'); // convert \ to / otherwise separators get lost on windows
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-button").classList.add("hidden")',
    );
    executeUnsafeJavaScript(
      `document.getElementById("custom-cert-path-text").innerText="${filepath}"`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-text").classList.remove("hidden")',
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-reset").classList.remove("hidden")',
    );
  }
}

function repaintShortcuts() {
  let shortcut =
    '<p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p><ul class="list-container">';
  if (store.shortcuts) {
    store.shortcuts.forEach((keys) => {
      shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
    });
    shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
  }
  shortcut += '</div>';
  setElementHtml('#shortcut', shortcut);
}

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function timeSince(date, direction = 'since') {
  let seconds;
  if (direction === 'since') {
    seconds = Math.floor((new Date() - date) / 1000);
  } else if (direction === 'to') {
    seconds = Math.floor((date - new Date()) / 1000);
  }
  let interval = seconds / 31536000;
  if (interval >= 2) {
    return `${Math.floor(interval)} years`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} year`;
  }
  interval = seconds / 2592000;
  if (interval > 2) {
    return `${Math.floor(interval)} months`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} month`;
  }
  interval = seconds / 604800;
  if (interval > 2) {
    return `${Math.floor(interval)} weeks`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} week`;
  }
  interval = seconds / 86400;
  if (interval > 2) {
    return `${Math.floor(interval)} days`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} day`;
  }
  interval = seconds / 3600;
  if (interval >= 2) {
    return `${Math.floor(interval)} hours`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} hour`;
  }
  interval = seconds / 60;
  if (interval > 2) {
    return `${Math.floor(interval)} minutes`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} minute`;
  }
  return `${Math.floor(seconds)} seconds`;
}

function logout() {
  deleteFromStore('user_id');
  deleteFromStore('username');
  deleteFromStore('access_token');
  deleteFromStore('custom_cert_path');
  deleteFromStore('host');
  deleteFromStore('plan');
  mb.window.webContents.session.clearCache();
  mb.window.webContents.session.clearStorageData();
  app.quit();
  app.relaunch();
}

function displayUsersProjects() {
  let favoriteProjectsHtml = '';
  const projects = store['favorite-projects'];
  if (projects && projects.length > 0) {
    favoriteProjectsHtml += '<ul class="list-container clickable" data-testid="favorite-projects">';
    const chevron = chevronLgRightIcon;
    projects.forEach((projectObject) => {
      const projectString = "'Project'";
      const jsonProjectObject = JSON.parse(JSON.stringify(projectObject));
      jsonProjectObject.name_with_namespace = projectObject.name_with_namespace;
      jsonProjectObject.namespace.name = projectObject.namespace.name;
      jsonProjectObject.name = projectObject.name;
      const projectJson = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
      favoriteProjectsHtml += `<li onclick="goToDetail(${projectString}, ${projectJson})">${projectIcon}`;
      favoriteProjectsHtml += `<div class="name-with-namespace"><span>${escapeHtml(
        projectObject.name,
      )}</span><span class="namespace">${escapeHtml(
        projectObject.namespace.name,
      )}</span></div><div class="chevron-right-wrapper">${chevron}</div></li>`;
    });
    favoriteProjectsHtml += '</ul>';
  } else {
    const projectLink = "'project-overview-link'";
    favoriteProjectsHtml = `<div class="new-project"><div><span class="cta">Track projects you care about</span> 🌟</div><div class="cta-description">Add any project you want a directly accessible shortcut for.</div><form class="project-input" action="#" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-overview-link" placeholder="Enter the project link here..." /><button class="add-button" id="project-overview-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-overview-error"></div></div>`;
  }
  setElementHtml('#projects', favoriteProjectsHtml);
}

async function getUsersProjects() {
  const projects = await callApi(`users/${store.user_id}/starred_projects`, {
    min_access_level: 30,
    per_page: numberOfFavoriteProjects,
    order_by: 'updated_at',
  });
  if (projects) {
    return projects.map((project) => ({
      id: project.id,
      visibility: project.visibility,
      web_url: project.web_url,
      name: project.name,
      namespace: {
        name: project.namespace.name,
      },
      added: Date.now(),
      name_with_namespace: project.name_with_namespace,
      open_issues_count: project.open_issues_count,
      last_activity_at: project.last_activity_at,
      avatar_url: project.avatar_url,
      star_count: project.star_count,
      forks_count: project.forks_count,
    }));
  }
  return false;
}

function getBookmarks() {
  const { bookmarks } = store;
  let bookmarksString = '';
  if (bookmarks && bookmarks.length > 0) {
    bookmarksString = '<ul class="list-container">';
    bookmarks.forEach((bookmark) => {
      let namespaceLink = '';
      if (bookmark.parent_name && bookmark.parent_url) {
        namespaceLink = ` &middot; <a href="${bookmark.parent_url}" target="_blank">${escapeHtml(
          bookmark.parent_name,
        )}</a>`;
      }

      let { title } = bookmark;

      if (bookmark.id && ['merge_requests', 'issues'].includes(bookmark.type)) {
        const typeIndicator = GitLab.indicatorForType(bookmark.type);
        title += ` (${typeIndicator}${bookmark.id})`;
      }

      bookmarksString += `<li class="history-entry bookmark-entry"><div class="bookmark-information"><a href="${escapeSingleQuotes(
        escapeHtml(bookmark.web_url),
      )}" id="bookmark-title" target="_blank">${escapeHtml(
        title,
      )}</a><span class="namespace-with-time">Added ${timeSince(
        bookmark.added,
      )} ago${namespaceLink}</span></div><div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteBookmark('${sha256hex(
        bookmark.web_url,
      )}')">${removeIcon}</div></div></li>`;
    });
    bookmarksString += `<li id="add-bookmark-dialog" class="more-link"><a onclick="startBookmarkDialog()">Add another bookmark ${chevronRightIcon}</a></li></ul>`;
  } else {
    const bookmarkLink = "'bookmark-link'";
    bookmarksString = `<div id="new-bookmark"><div><span class="cta">Add a new GitLab bookmark</span> 🔖</div><div class="cta-description">Bookmarks are helpful when you have an issue/merge request you will have to come back to repeatedly.</div><form id="bookmark-input" action="#" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter the link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div></div>`;
  }
  setElementHtml('#bookmarks', bookmarksString);
}

async function getRecentlyVisited() {
  if (lastRecentlyVisitedExecutionFinished && lastRecentlyVisitedExecution + delay < Date.now()) {
    lastRecentlyVisitedExecutionFinished = false;
    const recentlyVisitedArray = [];
    recentlyVisitedString = '';
    let firstItem = true;
    await BrowserHistory.getAllHistory().then(async (history) => {
      const item = Array.prototype.concat.apply([], history);
      item.sort((a, b) => {
        if (a.utc_time > b.utc_time) {
          return -1;
        }
        if (b.utc_time > a.utc_time) {
          return 1;
        }
        return -1;
      });
      let i = 0;
      for (let j = 0; j < item.length; j += 1) {
        if (
          item[j].title &&
          item[j].url.indexOf(`${store.host}/`) === 0 &&
          (item[j].url.indexOf('/-/issues/') !== -1 ||
            item[j].url.indexOf('/-/merge_requests/') !== -1 ||
            item[j].url.indexOf('/-/epics/') !== -1) &&
          !recentlyVisitedArray.includes(item[j].title) &&
          item[j].title.split('·')[0] !== 'Not Found' &&
          item[j].title.split('·')[0] !== 'New Issue ' &&
          item[j].title.split('·')[0] !== 'New Merge Request ' &&
          item[j].title.split('·')[0] !== 'New merge request ' &&
          item[j].title.split('·')[0] !== 'New Epic ' &&
          item[j].title.split('·')[0] !== 'Edit ' &&
          item[j].title.split('·')[0] !== 'Merge requests ' &&
          item[j].title.split('·')[0] !== 'Issues '
        ) {
          if (firstItem) {
            recentlyVisitedString = '<ul class="list-container">';
            firstItem = false;
          }
          const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
          if (nameWithNamespace.split('/')[0] !== 'groups') {
            item.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
              nameWithNamespace.split('/')[1]
            }?access_token=${store.access_token}`;
          } else {
            item.url = `${store.host}/api/v4/groups/${
              nameWithNamespace.split('/')[0]
            }?access_token=${store.access_token}`;
          }
          recentlyVisitedArray.push(item[j].title);
          if (item[j].title !== 'Checking your Browser - GitLab') {
            recentlyVisitedString += '<li class="history-entry">';
            recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
              item[j].title.split('·')[0],
            )}</a><span class="namespace-with-time">${timeSince(
              new Date(`${item[j].utc_time} UTC`),
            )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
              item[j].title.split('·')[2].trim(),
            )}</a></span></div></li>`;
            i += 1;
            if (i === numberOfRecentlyVisited) {
              break;
            }
          }
        }
      }
      if (!firstItem) {
        const moreString = "'Recently viewed'";
        recentlyVisitedString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
      } else if (BrowserHistory.isSupported()) {
        recentlyVisitedString = `<p class="no-results">Recently visited objects will show up here.<br/><span class="supported-browsers">Supported browsers: ${BrowserHistory.supportedBrowserNames()}.</span></p>`;
      } else {
        recentlyVisitedString =
          '<p class="no-results"><span class="supported-browsers">No browsers are supported on your operating system yet.</span></p>';
      }
      setElementHtml('#history', recentlyVisitedString);
      lastRecentlyVisitedExecution = Date.now();
      lastRecentlyVisitedExecutionFinished = true;
    });
  }
}

async function subscribeToRunningPipeline() {
  if (runningPipelineSubscriptionInterval !== -1) {
    clearInterval(runningPipelineSubscriptionInterval);
  }
  runningPipelineSubscriptionInterval = setInterval(async () => {
    runningPipelineSubscriptions.forEach(async (runningPipeline) => {
      const pipeline = await callApi(
        `projects/${runningPipeline.project_id}/pipelines/${runningPipeline.id}`,
      );
      if (pipeline) {
        let pipelineStatus;
        if (pipeline.status !== 'running') {
          if (pipeline.status === 'success') {
            pipelineStatus = 'succeeded';
          } else {
            pipelineStatus = pipeline.status;
          }
          const updateNotification = new Notification({
            title: `Pipeline ${pipelineStatus}`,
            subtitle: GitLab.fetchUrlInfo(pipeline.web_url).namespaceWithProject,
            body: runningPipeline.commit_title,
          });
          updateNotification.on('click', () => {
            shell.openExternal(pipeline.web_url);
          });
          updateNotification.show();
          runningPipelineSubscriptions = runningPipelineSubscriptions.filter(
            (subscriptionPipeline) => subscriptionPipeline.id !== pipeline.id,
          );
          if (runningPipelineSubscriptions.length === 0) {
            clearInterval(runningPipelineSubscriptionInterval);
            runningPipelineSubscriptionInterval = -1;
            mb.tray.setImage(`${__dirname}/assets/gitlabTemplate.png`);
          }
        }
      }
    });
  }, 10000);
}

async function getLastPipelines(commits) {
  const projectArray = [];
  if (commits && commits.length > 0) {
    commits.forEach(async (commit) => {
      if (!projectArray.includes(commit.project_id)) {
        projectArray.push(commit.project_id);
        const pipelines = await callApi(`projects/${commit.project_id}/pipelines`, {
          status: 'running',
          username: store.username,
          per_page: 1,
          page: 1,
        });
        if (pipelines && pipelines.length > 0) {
          mb.tray.setImage(`${__dirname}/assets/runningTemplate.png`);
          pipelines.forEach(async (pipeline) => {
            const commitPipeline = pipeline;
            if (
              runningPipelineSubscriptions.findIndex(
                (subscriptionPipeline) => subscriptionPipeline.id === pipeline.id,
              ) === -1
            ) {
              const pipelineCommit = await callApi(
                `projects/${pipeline.project_id}/repository/commits/${pipeline.sha}`,
              );
              if (pipelineCommit) {
                commitPipeline.commit_title = pipelineCommit.title;
                runningPipelineSubscriptions.push(commitPipeline);
                const runningNotification = new Notification({
                  title: 'Pipeline running',
                  subtitle: GitLab.fetchUrlInfo(commitPipeline.web_url).namespaceWithProject,
                  body: commitPipeline.commit_title,
                });
                runningNotification.on('click', () => {
                  shell.openExternal(commitPipeline.web_url);
                });
                runningNotification.show();
              }
            }
          });
          subscribeToRunningPipeline();
        }
      }
    });
  }
}

function displayAddError(type, target, customMessage) {
  executeUnsafeJavaScript(
    `document.getElementById("add-${type}${target}error").style.display = "block"`,
  );
  if (customMessage) {
    setElementHtml(`#add-${type}${target}error`, customMessage);
  } else {
    setElementHtml(`#add-${type}${target}error`, `This is not a valid GitLab ${type} URL.`);
  }
  executeUnsafeJavaScript(`document.getElementById("${type}${target}add-button").disabled = false`);
  executeUnsafeJavaScript(`document.getElementById("${type}${target}link").disabled = false`);
  setElementHtml(`#${type}${target}add-button`, 'Add');
}

function displayPagination(keysetLinks, type) {
  let paginationString = '';
  if (keysetLinks.indexOf('rel="next"') !== -1 || keysetLinks.indexOf('rel="prev"') !== -1) {
    paginationString += '<div id="pagination">';
    if (keysetLinks.indexOf('rel="prev"') !== -1) {
      let prevLink = '';
      prevLink = escapeHtml(`"${keysetLinks.split('>; rel="prev"')[0].substring(1)}"`);
      paginationString += `<button onclick="switchPage(${prevLink}, ${type})" class="prev">${chevronLgLeftIcon} Previous</button>`;
    } else {
      paginationString += '<div></div>';
    }
    if (keysetLinks.indexOf('rel="next"') !== -1) {
      let nextLink = '';
      if (keysetLinks.indexOf('rel="prev"') !== -1) {
        nextLink = escapeHtml(
          `"${keysetLinks.split('rel="prev", ')[1].split('>; rel="next"')[0].substring(1)}"`,
        );
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      } else {
        nextLink = escapeHtml(`"${keysetLinks.split('>; rel="next"')[0].substring(1)}"`);
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      }
    } else {
      paginationString += '<div></div>';
    }
    paginationString += '</div>';
  }
  return paginationString;
}

function renderCollabject(comment, collabject) {
  const collabObject = collabject;
  if (collabObject.message && collabObject.message === '404 Not found') {
    return 0;
  }
  if (comment.note.noteable_type === 'DesignManagement::Design') {
    collabObject.web_url += `/designs/${comment.target_title}`;
    return `<li class="comment"><a href="${collabObject.web_url}#note_${
      comment.note.id
    }" target="_blank">${escapeHtml(
      comment.note.body,
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(comment.created_at),
    )} ago &middot; <a href="${
      collabObject.web_url.split('#note')[0]
    }" target="_blank">${escapeHtml(comment.target_title)}</a></span></div></li>`;
  }
  return `<li class="comment"><a href="${collabObject.web_url}#note_${
    comment.note.id
  }" target="_blank">${escapeHtml(
    comment.note.body,
  )}</a><span class="namespace-with-time">${timeSince(
    new Date(comment.created_at),
  )} ago &middot; <a href="${collabObject.web_url.split('#note')[0]}" target="_blank">${escapeHtml(
    comment.target_title,
  )}</a></span></div></li>`;
}

function displayCommit(commit, project, focus = 'project') {
  let logo = '';
  if (commit.last_pipeline) {
    logo += `<a target="_blank" href="${commit.last_pipeline.web_url}" class="pipeline-link">`;
    if (commit.last_pipeline.status === 'scheduled') {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7"/><circle class="icon" style="fill: var(--svg-status-bg, #c9d1d9);" cx="7" cy="7" r="6"/><g transform="translate(2.75 2.75)" fill-rule="nonzero"><path d="M4.165 7.81a3.644 3.644 0 1 1 0-7.29 3.644 3.644 0 0 1 0 7.29zm0-1.042a2.603 2.603 0 1 0 0-5.206 2.603 2.603 0 0 0 0 5.206z"/><rect x="3.644" y="2.083" width="1.041" height="2.603" rx=".488"/><rect x="3.644" y="3.644" width="2.083" height="1.041" rx=".488"/></g></svg>';
    } else {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="M0 7a7 7 0 1 1 14 0A7 7 0 0 1 0 7z" class="icon"/><path d="M13 7A6 6 0 1 0 1 7a6 6 0 0 0 12 0z" class="icon-inverse" />';
      if (commit.last_pipeline.status === 'running') {
        logo +=
          '<path d="M7 3c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.3 0-2.5-.7-3.3-1.7L7 7V3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'failed') {
        logo +=
          '<path d="M7 5.969L5.599 4.568a.29.29 0 0 0-.413.004l-.614.614a.294.294 0 0 0-.004.413L5.968 7l-1.4 1.401a.29.29 0 0 0 .004.413l.614.614c.113.114.3.117.413.004L7 8.032l1.401 1.4a.29.29 0 0 0 .413-.004l.614-.614a.294.294 0 0 0 .004-.413L8.032 7l1.4-1.401a.29.29 0 0 0-.004-.413l-.614-.614a.294.294 0 0 0-.413-.004L7 5.968z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'success') {
        logo +=
          '<path d="M6.278 7.697L5.045 6.464a.296.296 0 0 0-.42-.002l-.613.614a.298.298 0 0 0 .002.42l1.91 1.909a.5.5 0 0 0 .703.005l.265-.265L9.997 6.04a.291.291 0 0 0-.009-.408l-.614-.614a.29.29 0 0 0-.408-.009L6.278 7.697z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'pending') {
        logo +=
          '<path d="M4.7 5.3c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H5c-.2 0-.3-.1-.3-.3V5.3m3 0c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H8c-.2 0-.3-.1-.3-.3V5.3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'canceled') {
        logo +=
          '<path d="M5.2 3.8l4.9 4.9c.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0L3.8 5.2c-.2-.2-.2-.5 0-.7l.7-.7c.2-.2.5-.2.7 0" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'skipped') {
        logo +=
          '<path d="M6.415 7.04L4.579 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L5.341 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L6.415 7.04zm2.54 0L7.119 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L7.881 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L8.955 7.04z" class="icon"/></svg>';
      } else if (commit.last_pipeline.status === 'created') {
        logo += '<circle cx="7" cy="7" r="3.25" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'preparing') {
        logo +=
          '</g><circle cx="7" cy="7" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="4" cy="7" r="1"/></g></svg>';
      } else if (commit.last_pipeline.status === 'manual') {
        logo +=
          '<path d="M10.5 7.63V6.37l-.787-.13c-.044-.175-.132-.349-.263-.61l.481-.652-.918-.913-.657.478a2.346 2.346 0 0 0-.612-.26L7.656 3.5H6.388l-.132.783c-.219.043-.394.13-.612.26l-.657-.478-.918.913.437.652c-.131.218-.175.392-.262.61l-.744.086v1.261l.787.13c.044.218.132.392.263.61l-.438.651.92.913.655-.434c.175.086.394.173.613.26l.131.783h1.313l.131-.783c.219-.043.394-.13.613-.26l.656.478.918-.913-.48-.652c.13-.218.218-.435.262-.61l.656-.13zM7 8.283a1.285 1.285 0 0 1-1.313-1.305c0-.739.57-1.304 1.313-1.304.744 0 1.313.565 1.313 1.304 0 .74-.57 1.305-1.313 1.305z" class="icon"/></g></svg>';
      }
    }
  }
  logo += '</a>';
  let subline;
  if (focus === 'project') {
    subline = `<a href="${project.web_url}" target=_blank">${escapeHtml(
      project.name_with_namespace,
    )}</a>`;
  } else {
    subline = escapeHtml(commit.author_name);
  }
  return `<div class="commit"><div class="commit-information"><a href="${
    commit.web_url
  }" target="_blank">${escapeHtml(commit.title)}</a><span class="namespace-with-time">${timeSince(
    new Date(commit.committed_date),
  )} ago &middot; ${subline}</span></div>${logo}</div>`;
}

function renderNoCommitsPushedYetMessage() {
  executeUnsafeJavaScript('document.getElementById("commits-pagination").classList.add("hidden")');
  setElementHtml('#pipeline', '<p class="no-results">You haven&#039;t pushed any commits yet.</p>');
}

async function getCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("commits-pagination").classList.remove("hidden")',
  );
  executeUnsafeJavaScript('document.getElementById("commits-count").classList.remove("empty")');
  setElementHtml('#commits-count', `${index}/${recentCommits.length}`);
  const project = await callApi(`projects/${projectId}`);
  const commit = await callApi(`projects/${project.id}/repository/commits/${sha}`);
  if (project && commit) {
    setElementHtml('#pipeline', displayCommit(commit, project));
  }
}

async function getLastCommits(count = 20) {
  if (lastLastCommitsExecutionFinished && lastLastCommitsExecution + delay < Date.now()) {
    lastLastCommitsExecutionFinished = false;

    const commits = await callApi('events', {
      action: 'pushed',
      per_page: count,
    });
    if (commits && Array.isArray(commits) && !commits.error) {
      if (commits && commits.length > 0) {
        lastEventId = commits[0].id;
        getLastPipelines(commits);
        const committedArray = commits.filter(
          /* eslint-disable implicit-arrow-linebreak */
          (commit) =>
            commit.action_name === 'pushed to' ||
            (commit.action_name === 'pushed new' &&
              commit.push_data.commit_to &&
              commit.push_data.commit_count > 0),
          /* eslint-enable */
        );
        if (committedArray && committedArray.length > 0) {
          [currentCommit] = committedArray;
          recentCommits = committedArray;
          getCommitDetails(committedArray[0].project_id, committedArray[0].push_data.commit_to, 1);
        } else {
          renderNoCommitsPushedYetMessage();
        }
      } else {
        renderNoCommitsPushedYetMessage();
      }
    }
    lastLastCommitsExecution = Date.now();
    lastLastCommitsExecutionFinished = true;
  }
}

async function getRecentComments() {
  if (lastRecentCommentsExecutionFinished && lastRecentCommentsExecution + delay < Date.now()) {
    lastRecentCommentsExecutionFinished = false;
    let recentCommentsString = '';

    const comments = await callApi('events', {
      action: 'commented',
      per_page: numberOfRecentComments,
    });
    if (comments && Array.isArray(comments) && !comments.error) {
      if (comments && comments.length > 0) {
        recentCommentsString += '<ul class="list-container">';
        /* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop */
        for (const comment of comments) {
          const path = GitLab.commentToNoteableUrl(comment);

          if (!path) {
            continue;
          }

          const collabject = await callApi(path);
          if (collabject) {
            recentCommentsString += renderCollabject(comment, collabject);
          }
        }
        // eslint-disable no-restricted-syntax */
        const moreString = "'Comments'";
        recentCommentsString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
        setElementHtml('#comments', recentCommentsString);
      } else {
        setElementHtml(
          '#comments',
          '<p class="no-results">You haven&#039;t written any comments yet.</p>',
        );
      }
    }
    lastRecentCommentsExecution = Date.now();
    lastRecentCommentsExecutionFinished = true;
  }
}

async function getLastEvent() {
  if (!recentCommits || recentCommits.length === 0) {
    return;
  }
  const lastEvent = await callApi('events', {
    action: 'pushed',
    per_page: 1,
  });
  if (lastEvent && lastEvent.id !== lastEventId) {
    lastEventId = lastEvent.id;
    getLastCommits();
    getRecentComments();
  }
}

async function getLastTodo() {
  const todo = await callApi('todos', {
    per_page: 1,
  });
  if (todo && lastTodoId !== todo.id) {
    if (lastTodoId !== -1 && Date.parse(todo.created_at) > Date.now() - 20000) {
      const todoNotification = new Notification({
        title: todo.body,
        subtitle: todo.author.name,
        body: todo.target.title,
      });
      todoNotification.on('click', () => {
        shell.openExternal(todo.target_url);
      });
      todoNotification.show();
    }
    lastTodoId = todo.id;
  }
}

async function getUser() {
  if (lastUserExecutionFinished && lastUserExecution + delay < Date.now()) {
    lastUserExecutionFinished = false;

    const user = await callApi('user');
    if (user && !user.error) {
      let avatarUrl;
      if (user.avatar_url) {
        avatarUrl = new URL(user.avatar_url);
        if (avatarUrl.host !== 'secure.gravatar.com') {
          avatarUrl.href += '?width=64';
        }
      }
      const userHtml = `<a href="${user.web_url}" target="_blank"><img src="${
        avatarUrl.href
      }" /><div class="user-information"><span class="user-name">${escapeHtml(
        user.name,
      )}</span><span class="username">@${escapeHtml(user.username)}</span></div></a>`;
      setElementHtml('#user', userHtml);
      lastUserExecution = Date.now();
      lastUserExecutionFinished = true;
    }
  }
}

function tryRefresh() {
  if (!refreshInProgress) {
    refreshInProgress = true;
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        refresh_token: store.refresh_token,
        grant_type: 'refresh_token',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        if (result.access_token && result.refresh_token) {
          store.access_token = result.access_token;
          store.refresh_token = result.refresh_token;
          lastUserExecution = 0;
          lastLastCommitsExecution = 0;
          lastRecentCommentsExecution = 0;

          lastUserExecutionFinished = true;
          lastLastCommitsExecutionFinished = true;
          lastRecentCommentsExecutionFinished = true;

          getUser();
          getLastTodo();
          getLastCommits();
          getRecentComments();
        } else {
          logout();
        }
        refreshInProgress = false;
      })
      .catch(() => {
        refreshInProgress = false;
        logout();
      });
  }
}

async function saveUser(
  accessToken,
  url = store.host,
  customCertPath = undefined,
  refreshToken = undefined,
) {
  try {
    if (url.endsWith('/')) {
      /* eslint-disable no-param-reassign */
      url = url.substring(0, url.length - 1);
    }
    /* eslint-disable operator-linebreak, object-curly-newline */
    const options = customCertPath
      ? { access_token: accessToken, custom_cert_path: customCertPath }
      : { access_token: accessToken };
    /* eslint-enable */
    const result = await callApi('user', options, url);
    if (result && result.id && result.username) {
      store.access_token = accessToken;
      store.user_id = result.id;
      store.username = result.username;
      store.host = url;
      if (refreshToken) {
        store.refresh_token = refreshToken;
      }
      if (customCertPath) {
        store.custom_cert_path = customCertPath;
      }
      getUsersProjects().then(async (projects) => {
        if (
          store['favorite-projects'] &&
          store['favorite-projects'].length === 0 &&
          projects &&
          projects.length > 0
        ) {
          store['favorite-projects'] = projects;
        }
        // eslint-disable-next-line no-use-before-define
        mb.window.removeListener('page-title-updated', handleLogin);
        await mb.window
          .loadURL(`file://${__dirname}/index.html`)
          .then(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          })
          .catch(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          });
      });
    }
  } catch (e) {
    throw new Error(e);
  }
}

function handleLogin() {
  if (mb.window.webContents.getURL().indexOf('?code=') !== -1) {
    const code = mb.window.webContents.getURL().split('?code=')[1].replace('&state=test', '');
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
        code_verifier: verifier,
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        saveUser(result.access_token, 'https://gitlab.com', undefined, result.refresh_token);
      });
  }
}

async function startLogin() {
  verifier = base64URLEncode(nodeCrypto.randomBytes(32));
  challenge = base64URLEncode(sha256(verifier));
  await mb.window.loadURL(
    `${store.host}/oauth/authorize?client_id=2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee&redirect_uri=https://mvanremmerden.gitlab.io/gitdock-login/&response_type=code&state=test&scope=read_api&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  mb.window.on('page-title-updated', handleLogin);
  mb.showWindow();
}

async function getUsersPlan() {
  let userNamespace;
  const namespaces = await callApi('namespaces');
  if (namespaces && namespaces.length > 0) {
    userNamespace = namespaces.find((namespace) => namespace.kind === 'user');
  }

  store.plan = userNamespace && userNamespace.plan ? userNamespace.plan : 'free';
}

async function getProjectCommits(project, count = 20) {
  const commits = await callApi(`projects/${project.id}/repository/commits`, {
    per_page: count,
  });
  if (commits && commits.length > 0) {
    recentProjectCommits = commits;
    [currentProjectCommit] = commits;

    const commit = await callApi(`projects/${project.id}/repository/commits/${commits[0].id}`, {
      per_page: count,
    });
    if (commit) {
      const pagination = `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="project-commits-count">1/${recentProjectCommits.length}</span><button onclick="changeProjectCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeProjectCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`;
      setElementHtml('#detail-headline', pagination);
      setElementHtml('#project-pipeline', displayCommit(commit, project, 'author'));
    }
  } else {
    setElementHtml('#project-commits-pagination', '<span class="name">Commits</span>');
    setElementHtml('#project-pipeline', '<p class="no-results">No commits pushed yet.</p>');
  }
}

function changeCommit(forward, commitArray, chosenCommit) {
  let nextCommit;
  let index = commitArray.findIndex((commit) => commit.id === chosenCommit.id);
  if (forward) {
    if (index === commitArray.length - 1) {
      [nextCommit] = commitArray;
      index = 1;
    } else {
      nextCommit = commitArray[index + 1];
      index += 2;
    }
  } else if (index === 0) {
    nextCommit = commitArray[commitArray.length - 1];
    index = commitArray.length;
  } else {
    nextCommit = commitArray[index - 1];
  }
  nextCommit.index = index;
  return nextCommit;
}

async function getProjectCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("project-commits-count").classList.remove("empty")',
  );
  setElementHtml('#project-commits-count', `${index}/${recentProjectCommits.length}`);

  const commit = await callApi(`projects/${projectId}/repository/commits/${sha}`);
  if (commit) {
    setElementHtml('#project-pipeline', displayCommit(commit, currentProject, 'author'));
  }
}

async function getMoreRecentlyVisited() {
  recentlyVisitedString = '';
  let firstItem = true;
  await BrowserHistory.getAllHistory().then(async (history) => {
    const item = Array.prototype.concat.apply([], history);
    item.sort((a, b) => {
      if (a.utc_time > b.utc_time) {
        return -1;
      }
      if (b.utc_time > a.utc_time) {
        return 1;
      }
      return -1;
    });
    setElementHtml(
      '#detail-headline',
      '<input id="recentSearch" type="text" onkeyup="searchRecent(this)" placeholder="Search..." />',
    );

    let previousDate = 0;
    for (let j = 0; j < item.length; j += 1) {
      const { title } = item[j];
      let { url } = item[j];
      const isHostUrl = url.startsWith(`${store.host}/`);
      const isIssuable =
        url.includes('/-/issues/') ||
        url.includes('/-/merge_requests/') ||
        url.includes('/-/epics/');
      const wasNotProcessed = !moreRecentlyVisitedArray.some((object) => object.title === title);
      const ignoredTitlePrefixes = [
        'Not Found',
        'New Issue',
        'New Merge Request',
        'New merge request',
        'New Epic',
        'Edit',
        'Merge Conflicts',
        'Merge requests',
        'Issues',
        '500 Error - GitLab',
        'Checking your Browser - GitLab',
      ];
      const titlePrefix = (title || '').split('·')[0].trim();
      if (
        title &&
        isHostUrl &&
        isIssuable &&
        wasNotProcessed &&
        !ignoredTitlePrefixes.includes(titlePrefix)
      ) {
        const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
        if (nameWithNamespace.split('/')[0] !== 'groups') {
          url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
            nameWithNamespace.split('/')[1]
          }?access_token=${store.access_token}`;
        } else {
          url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
            store.access_token
          }`;
        }
        const currentDate = new Date(item[j].utc_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: timezone,
        });
        if (previousDate !== currentDate) {
          if (
            currentDate ===
            new Date(Date.now()).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              timeZone: timezone,
            })
          ) {
            recentlyVisitedString += '<div class="date">Today</div>';
          } else {
            if (!firstItem) {
              recentlyVisitedString += '</ul>';
            }
            recentlyVisitedString += `<div class="date">${currentDate}</div>`;
          }
          recentlyVisitedString += '<ul class="list-container history-list-container">';
          previousDate = currentDate;
        }
        moreRecentlyVisitedArray.push(item[j]);
        recentlyVisitedString += '<li class="history-entry">';
        recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
          item[j].title.split('·')[0],
        )}</a><span class="namespace-with-time">${timeSince(
          new Date(`${item[j].utc_time} UTC`),
        )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
          item[j].title.split('·')[2].trim(),
        )}</a></span></div></li>`;
        firstItem = false;
      }
    }
    recentlyVisitedString += '</ul>';
    setElementHtml('#detail-content', recentlyVisitedString);
  });
}

function searchRecentlyVisited(searchterm) {
  /* eslint-disable implicit-arrow-linebreak, function-paren-newline */
  const foundArray = moreRecentlyVisitedArray.filter((item) =>
    item.title.toLowerCase().includes(searchterm),
  );
  /* eslint-enable */
  let foundString = '<ul class="list-container">';
  foundArray.forEach((item) => {
    const object = item;
    const nameWithNamespace = object.url.replace(`${store.host}/`, '').split('/-/')[0];
    if (nameWithNamespace.split('/')[0] !== 'groups') {
      object.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
        nameWithNamespace.split('/')[1]
      }?access_token=${store.access_token}`;
    } else {
      object.url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
        store.access_token
      }`;
    }
    foundString += '<li class="history-entry">';
    foundString += `<a href="${object.url}" target="_blank">${escapeHtml(
      object.title.split('·')[0],
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(`${object.utc_time} UTC`),
    )} ago &middot; <a href="${object.url.split('/-/')[0]}" target="_blank">${escapeHtml(
      object.title.split('·')[2].trim(),
    )}</a></span></div></li>`;
  });
  foundString += '</ul>';
  setElementHtml('#detail-content', foundString);
}

function getMoreRecentComments(
  url = `${store.host}/api/v4/events?action=commented&per_page=${numberOfComments}&access_token=${store.access_token}`,
) {
  let recentCommentsString = '<ul class="list-container">';
  const type = "'Comments'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then(async (comments) => {
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const comment of comments) {
        const path = GitLab.commentToNoteableUrl(comment);
        const collabject = await callApi(path);
        if (collabject) {
          recentCommentsString += renderCollabject(comment, collabject);
        }
      }
      /* eslint-enable */
      recentCommentsString += `</ul>${displayPagination(keysetLinks, type)}`;
      setElementHtml('#detail-content', recentCommentsString);
    });
}

function getIssues(
  url = `${store.host}/api/v4/issues?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let issuesString = '';
  const type = "'Issues'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((issues) => {
      if (issues && issues.length > 0) {
        issuesString += '<ul class="list-container">';
        issues.forEach((issue) => {
          let timestamp;
          if (activeIssuesSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(issue.updated_at))} ago`;
          } else if (activeIssuesSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(issue.created_at))} ago`;
          } else if (activeIssuesSortOption === 'due_date&sort=asc') {
            if (!issue.due_date) {
              timestamp = 'No due date';
            } else if (new Date() > new Date(issue.due_date)) {
              timestamp = `Due ${timeSince(new Date(issue.due_date))} ago`;
            } else {
              timestamp = `Due in ${timeSince(new Date(issue.due_date), 'to')}`;
            }
          }
          issuesString += '<li class="history-entry">';
          issuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
            issue.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            issue.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(
            issue.references.full.split('#')[0],
          )}</a></span></div></li>`;
        });
        issuesString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        issuesString = `<div class="zero">${illustration}<p>No issues with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, issuesString);
    });
}

function getMRs(
  url = `${store.host}/api/v4/merge_requests?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let mrsString = '';
  const type = "'MRs'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((mrs) => {
      if (mrs && mrs.length > 0) {
        mrsString = '<ul class="list-container">';
        mrs.forEach((mr) => {
          let timestamp;
          if (activeMRsSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(mr.updated_at))} ago`;
          } else if (activeMRsSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(mr.created_at))} ago`;
          }
          mrsString += '<li class="history-entry">';
          mrsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
            mr.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            mr.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(mr.references.full.split('!')[0])}</a></span></div></li>`;
        });
        mrsString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        mrsString = `<div class="zero">${illustration}<p>No merge requests with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, mrsString);
    });
}

function getTodos(
  url = `${store.host}/api/v4/todos?per_page=${numberOfTodos}&access_token=${store.access_token}`,
) {
  let todosString = '';
  const type = "'Todos'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((todos) => {
      if (todos && todos.length > 0) {
        todosString = '<ul class="list-container">';
        todos.forEach((todo) => {
          const item = todo;
          todosString += '<li class="history-entry">';
          let location = '';
          if (item.project) {
            location = item.project.name_with_namespace;
          } else if (item.group) {
            location = item.group.name;
          }
          if (item.target_type === 'DesignManagement::Design') {
            item.target.title = item.body;
          }
          todosString += `<a href="${item.target_url}" target="_blank">${escapeHtml(
            item.target.title,
          )}</a><span class="namespace-with-time">Updated ${timeSince(
            new Date(item.updated_at),
          )} ago &middot; <a href="${item.target_url.split('/-/')[0]}" target="_blank">${escapeHtml(
            location,
          )}</a></span></div></li>`;
        });
        todosString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        todosString = `<div class="zero">${illustration}<p>Take the day off, you have no To-Dos!</p></div>`;
      }
      setElementHtml('#detail-content', todosString);
    });
}

function setupEmptyProjectPage() {
  let emptyPage =
    '<div id="project-pipeline"><div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div></div><div id="project-name"></div></div>';
  emptyPage += '<div class="headline"><span class="name">Issues</span></div>';
  emptyPage +=
    '<div id="project-recent-issues"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  emptyPage += '<div class="headline"><span class="name">Merge requests</span></div>';
  emptyPage +=
    '<div id="project-recent-mrs"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  setElementHtml('#detail-content', emptyPage);
}

function displayProjectPage(project) {
  let logo;
  if (project.avatar_url && project.avatar_url != null && project.visibility === 'public') {
    logo = `<img id="project-detail-avatar" src="${project.avatar_url}?width=64" />`;
  } else {
    logo = `<div id="project-detail-name-avatar">${project.name.charAt(0).toUpperCase()}</div>`;
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml(
    '#detail-header-content',
    `<div id="project-detail-information">
        ${logo}
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-namespace">
          ${escapeHtml(project.namespace.name)}
        </span>
      </div>
      <div class="detail-external-link">
        <a href="${escapeHtml(project.web_url)}" target="_blank">${externalLinkIcon}</a>
      </div>`,
  );
}

async function getProjectIssues(project) {
  let projectIssuesString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const issuesString = "'Issues'";

  const issues = await callApi(`projects/${project.id}/issues`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (issues && issues.length > 0) {
    projectIssuesString = '<ul class="list-container">';
    issues.forEach((issue) => {
      projectIssuesString += '<li class="history-entry">';
      projectIssuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
        issue.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(issue.created_at),
      )} ago &middot; ${escapeHtml(issue.author.name)}</span></div></li>`;
    });
    projectIssuesString += `<li class="more-link"><a onclick="goToSubDetail(${issuesString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectIssuesString += '</ul>';
  } else {
    projectIssuesString = '<p class="no-results with-all-link">No open issues.</p>';
    projectIssuesString += `<div class="all-link"><a onclick="goToSubDetail(${issuesString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-issues', projectIssuesString);
}

async function getProjectMRs(project) {
  let projectMRsString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const mrsString = "'Merge Requests'";

  const mrs = await callApi(`projects/${project.id}/merge_requests`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (mrs && mrs.length > 0) {
    projectMRsString += '<ul class="list-container">';
    mrs.forEach((mr) => {
      projectMRsString += '<li class="history-entry">';
      projectMRsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
        mr.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(mr.created_at),
      )} ago &middot; ${escapeHtml(mr.author.name)}</span></div></li>`;
    });
    projectMRsString += `<li class="more-link"><a onclick="goToSubDetail(${mrsString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectMRsString += '</ul>';
  } else {
    projectMRsString = '<p class="no-results with-all-link">No open merge requests.</p>';
    projectMRsString += `<div class="all-link"><a onclick="goToSubDetail(${mrsString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-mrs', projectMRsString);
}

function addBookmark(link) {
  if (store && store.bookmarks && store.bookmarks.length > 0) {
    const sameBookmarks = store.bookmarks.filter((item) => item.web_url === link);
    if (sameBookmarks.length > 0) {
      displayAddError('bookmark', '-', 'This bookmark has already been added.');
      return;
    }
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("bookmark-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").disabled = "disabled"');
  setElementHtml('#bookmark-add-button', `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then((bookmark) => {
        const allowedTypes = [
          'issues',
          'merge_requests',
          'epics',
          'projects',
          'groups',
          'boards',
          'users',
          'unknown',
        ];

        if (allowedTypes.includes(bookmark.type)) {
          const bookmarks = store.bookmarks || [];
          bookmarks.push(bookmark);
          store.bookmarks = bookmarks;
          getBookmarks();
        } else {
          displayAddError('bookmark', '-');
        }
      })
      .catch(() => {
        displayAddError('bookmark', '-');
      });
  } else {
    displayAddError('bookmark', '-');
  }
}

function addProject(link, target) {
  let newTarget = target;
  if (newTarget === 'project-settings-link') {
    newTarget = '-settings-';
  } else if (newTarget === 'project-overview-link') {
    newTarget = '-overview-';
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}add-button").disabled = "disabled"`,
  );
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}link").disabled = "disabled"`,
  );
  setElementHtml(`#project${newTarget}add-button`, `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then(async (object) => {
        if (
          !store['favorite-projects'] ||
          !store['favorite-projects'].filter((project) => project.web_url === object.web_url).length
        ) {
          if (object.type && object.type !== 'projects') {
            const projectWithNamespace = encodeURIComponent(
              link.split(`${store.host}/`)[1],
            ).replace(/%2F$/, '');
            const project = await callApi(`projects/${projectWithNamespace}`);
            const projects = store['favorite-projects'] || [];
            projects.push({
              id: project.id,
              visibility: project.visibility,
              web_url: project.web_url,
              name: project.name,
              title: project.name,
              namespace: {
                name: project.namespace.name,
              },
              parent_name: project.name_with_namespace,
              parent_url: project.namespace.web_url,
              name_with_namespace: project.name_with_namespace,
              open_issues_count: project.open_issues_count,
              last_activity_at: project.last_activity_at,
              avatar_url: project.avatar_url,
              star_count: project.star_count,
              forks_count: project.forks_count,
            });
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          } else {
            const projects = store['favorite-projects'] || [];
            projects.push(object);
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          }
        } else {
          displayAddError('project', newTarget, 'The same project was already added.');
        }
      })
      .catch(() => {
        displayAddError('project', newTarget);
      });
  } else {
    displayAddError('project', newTarget);
  }
}

function addShortcut(link) {
  const tempArray = [link];
  store.shortcuts = store.shortcuts.concat(tempArray);
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("shortcut-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").disabled = "disabled"');
  setElementHtml('#shortcut-add-button', `${spinner} Add`);
  setupCommandPalette();
  repaintShortcuts();
}

function startBookmarkDialog() {
  const bookmarkLink = "'bookmark-link'";
  const bookmarkInput = `<form action="#" id="bookmark-input" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter your link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-bookmark-dialog").classList.add("opened")');
  setElementHtml('#add-bookmark-dialog', bookmarkInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").focus()');
}

function startProjectDialog() {
  const projectLink = "'project-settings-link'";
  const projectInput = `<form action="#" class="project-input" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-settings-link" placeholder="Enter the link to the project here..." /><button class="add-button" id="project-settings-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-settings-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-project-dialog").classList.add("opened")');
  setElementHtml('#add-project-dialog', projectInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("project-settings-link").focus()');
}

function startShortcutDialog() {
  const shortcutLink = "'shortcut-link'";
  const shortcutInput = `<form action="#" class="shortcut-input" onsubmit="addShortcut(document.getElementById(${shortcutLink}).value);return false;"><input class="shortcut-link" id="shortcut-link" placeholder="Enter the keyboard shortcut here..." /><button class="add-button" id="shortcut-add-button" type="submit">Add</button></form><div class="add-shortcut-error" id="add-shortcut-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-shortcut-dialog").classList.add("opened")');
  setElementHtml('#add-shortcut-dialog', shortcutInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").focus()');
}

function displaySkeleton(count, pagination = false, id = 'detail-content') {
  let skeletonString = '<ul class="list-container empty';
  if (pagination) {
    skeletonString += ' with-pagination">';
  } else {
    skeletonString += '">';
  }
  for (let i = 0; i < count; i += 1) {
    skeletonString +=
      '<li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li>';
  }
  skeletonString += '</ul>';
  setElementHtml(`#${id}`, skeletonString);
}

function changeTheme(option = 'light', manual = false) {
  store.theme = option;
  if (option === 'light') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "light");');
  } else if (option === 'dark') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "dark");');
  }
  if (manual) {
    executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
    executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
    executeUnsafeJavaScript(`document.getElementById("${option}-mode").classList.add("active")`);
  }
}

mb.on('ready', () => {
  setupContextMenu();
  setupCommandPalette();

  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (store.analytics) {
      visitor.event('Visit external link', true).send();
    }
    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });
});

if (store.access_token && store.user_id && store.username) {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();

    mb.showWindow();
    changeTheme(store.theme, false);

    // Preloading content
    getUser();
    getLastTodo();
    getUsersPlan();
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();

    // Regularly relaoading content
    setInterval(() => {
      getLastEvent();
      getLastTodo();
    }, 10000);
  });

  mb.on('show', () => {
    if (store.analytics) {
      visitor.pageview('/').send();
    }
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();
  });
} else {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();
    mb.window.loadURL(`file://${__dirname}/login.html`).then(() => {
      changeTheme(store.theme, false);
      mb.showWindow();
    });
  });
}

ipcMain.on('detail-page', (event, arg) => {
  setElementHtml('#detail-headline', '');
  setElementHtml('#detail-content', '');
  if (arg.page === 'Project') {
    if (store.analytics) {
      visitor.pageview('/project').send();
    }
    setElementHtml(
      '#detail-headline',
      `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="commits-count" class="empty"></span><button onclick="changeCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`,
    );
    setupEmptyProjectPage();
    const project = JSON.parse(arg.object);
    currentProject = project;
    displayProjectPage(project);
    getProjectCommits(project);
    getProjectIssues(project);
    getProjectMRs(project);
  } else {
    executeUnsafeJavaScript(
      'document.getElementById("detail-header-content").classList.remove("empty")',
    );
    setElementHtml('#detail-header-content', arg.page);
    if (arg.page === 'Issues') {
      if (store.analytics) {
        visitor.pageview('/my-issues').send();
      }
      const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
      const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
          <div class="filter-sort">
            ${issuesQuerySelect}
            ${issuesStateSelect}
            ${issuesSortSelect}
          </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfIssues);
      getIssues();
    } else if (arg.page === 'Merge requests') {
      if (store.analytics) {
        visitor.pageview('/my-merge-requests').send();
      }
      let mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label>`;
      if (store.plan !== 'free') {
        mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label>`;
      }
      mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
      const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfMRs);
      getMRs();
    } else if (arg.page === 'To-Do list') {
      if (store.analytics) {
        visitor.pageview('/my-to-do-list').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      setElementHtml(
        '#detail-header-content',
        `${arg.page}<div class="detail-external-link">
        <a href="${escapeHtml(store.host)}/dashboard/todos" target="_blank">
          ${externalLinkIcon}
        </a>
        </div>`,
      );
      displaySkeleton(numberOfTodos);
      getTodos();
    } else if (arg.page === 'Recently viewed') {
      if (store.analytics) {
        visitor.pageview('/my-history').send();
      }
      displaySkeleton(numberOfRecentlyVisited);
      getMoreRecentlyVisited();
    } else if (arg.page === 'Comments') {
      if (store.analytics) {
        visitor.pageview('/my-comments').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      displaySkeleton(numberOfComments);
      getMoreRecentComments();
    }
  }
});

ipcMain.on('sub-detail-page', (event, arg) => {
  isOnSubPage = true;
  activeIssuesQueryOption = 'all';
  activeMRsQueryOption = 'all';
  let activeState = 'Open';
  let allChecked = '';
  let openChecked = ' checked';
  let allChanged = '';
  const project = JSON.parse(arg.project);
  setElementHtml('#sub-detail-headline', '');
  setElementHtml('#sub-detail-content', '');
  executeUnsafeJavaScript(
    'document.getElementById("sub-detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#sub-detail-header-content', arg.page);
  if (arg.page === 'Issues') {
    if (store.analytics) {
      visitor.pageview('/project/issues').send();
    }
    if (arg.all === true) {
      activeIssuesStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
    const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="issues-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}-issues" onchange="switchIssues(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-issues" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${issuesQuerySelect}
          ${issuesStateSelect}
          ${issuesSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfIssues, undefined, 'sub-detail-content');
    getIssues(
      `${store.host}/api/v4/projects/${project.id}/issues?scope=all&state=${activeIssuesStateOption}&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  } else if (arg.page === 'Merge Requests') {
    if (store.analytics) {
      visitor.pageview('/project/merge-requests').send();
    }
    if (arg.all === true) {
      activeMRsStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
    const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="mrs-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}-state" onchange="switchMRs(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-state" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})"><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})" checked><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfMRs, undefined, 'sub-detail-content');
    getMRs(
      `${store.host}/api/v4/projects/${project.id}/merge_requests?scope=all&state=${activeMRsStateOption}&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  }
});

ipcMain.on('back-to-detail-page', () => {
  isOnSubPage = false;
  activeIssuesQueryOption = 'assigned_to_me';
  activeMRsQueryOption = 'assigned_to_me';
});

ipcMain.on('go-to-overview', () => {
  if (store.analytics) {
    visitor.pageview('/').send();
  }
  getRecentlyVisited();
  getRecentComments();
  displayUsersProjects();
  getBookmarks();
  executeUnsafeJavaScript(
    'document.getElementById("detail-headline").classList.remove("with-overflow")',
  );
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.add("empty")',
  );
  setElementHtml('#detail-header-content', '');
  activeIssuesQueryOption = 'assigned_to_me';
  activeIssuesStateOption = 'opened';
  activeIssuesSortOption = 'created_at';
  activeMRsQueryOption = 'assigned_to_me';
  activeMRsStateOption = 'opened';
  activeMRsSortOption = 'created_at';
  moreRecentlyVisitedArray = [];
  recentProjectCommits = [];
  currentProjectCommit = null;
  currentProject = null;
});

ipcMain.on('go-to-settings', () => {
  openSettingsPage();
});

ipcMain.on('switch-issues', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch issues', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeIssuesQueryOption) {
    activeIssuesQueryOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-query-active', arg.text);
    if (
      (isOnSubPage === false && arg.label !== 'assigned_to_me') ||
      (isOnSubPage === true && arg.label !== 'all')
    ) {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'state' && arg.label !== activeIssuesStateOption) {
    activeIssuesStateOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeIssuesSortOption) {
    activeIssuesSortOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.remove("changed")',
      );
    }
  }
  url += `issues?scope=${activeIssuesQueryOption}&state=${activeIssuesStateOption}&order_by=${activeIssuesSortOption}&per_page=${numberOfIssues}&access_token=${store.access_token}`;
  getIssues(url, id);
});

ipcMain.on('switch-mrs', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch merge requests', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeMRsQueryOption) {
    activeMRsQueryOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-query-active', arg.text);
    if (arg.label !== 'all') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.remove("changed")',
      );
    }
  }
  if (arg.type === 'state' && arg.label !== activeMRsStateOption) {
    activeMRsStateOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeMRsSortOption) {
    activeMRsSortOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.remove("changed")',
      );
    }
  }
  url += 'merge_requests?scope=';
  if (activeMRsQueryOption === 'assigned_to_me' || activeMRsQueryOption === 'created_by_me') {
    url += activeMRsQueryOption;
  } else if (activeMRsQueryOption === 'approved_by_me') {
    url += `all&approved_by_ids[]=${store.user_id}`;
  } else if (activeMRsQueryOption === 'review_requests_for_me') {
    url += `all&reviewer_id=${store.user_id}`;
  } else if (activeMRsQueryOption === 'approval_rule_for_me') {
    url += `all&approver_ids[]=${store.user_id}`;
  }
  url += `&state=${activeMRsStateOption}&order_by=${activeMRsSortOption}&per_page=${numberOfMRs}&access_token=${store.access_token}`;
  getMRs(url, id);
});

ipcMain.on('switch-page', (event, arg) => {
  let id;
  if (isOnSubPage) {
    id = 'sub-detail-content';
  } else {
    id = 'detail-content';
  }
  if (arg.type === 'Todos') {
    displaySkeleton(numberOfTodos, true);
    getTodos(arg.url);
  } else if (arg.type === 'Issues') {
    displaySkeleton(numberOfIssues, true, id);
    getIssues(arg.url, id);
  } else if (arg.type === 'MRs') {
    displaySkeleton(numberOfMRs, true, id);
    getMRs(arg.url, id);
  } else if (arg.type === 'Comments') {
    displaySkeleton(numberOfComments, true);
    getMoreRecentComments(arg.url);
  }
});

ipcMain.on('search-recent', (event, arg) => {
  setElementHtml('#detail-content', '');
  searchRecentlyVisited(arg);
});

ipcMain.on('change-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate my commits', 'next').send();
    } else {
      visitor.event('Navigate my commits', 'previous').send();
    }
  }
  setElementHtml(
    '#pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentCommits, currentCommit);
  currentCommit = nextCommit;
  getCommitDetails(nextCommit.project_id, nextCommit.push_data.commit_to, nextCommit.index);
});

ipcMain.on('change-project-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate project commits', 'next').send();
    } else {
      visitor.event('Navigate project commits', 'previous').send();
    }
  }
  setElementHtml(
    '#project-pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentProjectCommits, currentProjectCommit);
  currentProjectCommit = nextCommit;
  getProjectCommitDetails(currentProject.id, nextCommit.id, nextCommit.index);
});

ipcMain.on('add-bookmark', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add bookmark').send();
  }
  addBookmark(arg);
});

ipcMain.on('add-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add project').send();
  }
  addProject(arg.input, arg.target);
});

ipcMain.on('add-shortcut', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add shortcut').send();
  }
  addShortcut(arg);
});

ipcMain.on('start-bookmark-dialog', () => {
  startBookmarkDialog();
});

ipcMain.on('start-project-dialog', () => {
  startProjectDialog();
});

ipcMain.on('start-shortcut-dialog', () => {
  startShortcutDialog();
});

ipcMain.on('delete-bookmark', (event, hashedUrl) => {
  if (store.analytics) {
    visitor.event('Delete bookmark').send();
  }
  if (store.bookmarks && store.bookmarks.length > 0) {
    const newBookmarks = store.bookmarks.filter(
      (bookmark) => sha256hex(bookmark.web_url) !== hashedUrl,
    );
    store.bookmarks = newBookmarks;
  }
  getBookmarks();
});

ipcMain.on('delete-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Delete project').send();
  }
  const projects = store['favorite-projects'];
  const newProjects = projects.filter((project) => project.id !== arg);
  store['favorite-projects'] = newProjects;
  // TODO Implement better way to refresh view after deleting project
  displayUsersProjects();
  openSettingsPage();
});

ipcMain.on('delete-shortcut', (event, arg) => {
  store.shortcuts = store.shortcuts.filter((keys) => keys !== arg);
  setupCommandPalette();
  repaintShortcuts();
});

ipcMain.on('change-theme', (event, arg) => {
  if (store.analytics) {
    visitor.event('Change theme', arg).send();
  }
  changeTheme(arg, true);
});

ipcMain.on('change-analytics', (event, arg) => {
  store.analytics = arg;
  if (store.analytics) {
    visitor = ua('UA-203420427-1', store.analytics_id);
  } else {
    visitor = null;
  }
});

ipcMain.on('change-keep-visible', (event, arg) => {
  store.keep_visible = arg;
  mb.window.setAlwaysOnTop(arg);
});

ipcMain.on('change-show-dock-icon', (event, arg) => {
  mb.window.setAlwaysOnTop(true);
  store.show_dock_icon = arg;
  if (arg) {
    app.dock.show().then(() => {
      mb.window.setAlwaysOnTop(store.keep_visible);
    });
  } else {
    app.dock.hide();
    app.focus({
      steal: true,
    });
    setTimeout(() => {
      app.focus({
        steal: true,
      });
      mb.window.setAlwaysOnTop(store.keep_visible);
    }, 200);
  }
});

ipcMain.on('choose-certificate', () => {
  chooseCertificate();
});

ipcMain.on('reset-certificate', () => {
  executeUnsafeJavaScript('document.getElementById("custom-cert-path-text").innerText=""');
  executeUnsafeJavaScript(
    'document.getElementById("custom-cert-path-text").classList.add("hidden")',
  );
  chooseCertificate();
});

ipcMain.on('start-login', () => {
  startLogin();
});

ipcMain.on('start-manual-login', (event, arg) => {
  if (arg.custom_cert_path) {
    saveUser(arg.access_token, arg.host, arg.custom_cert_path);
  } else {
    saveUser(arg.access_token, arg.host);
  }
});

ipcMain.on('logout', () => {
  if (store.analytics) {
    visitor.event('Log out', true).send();
  }
  logout();
});

/* eslint-env es2021 */
const { menubar } = require('menubar');
const { Menu, Notification, shell, ipcMain, dialog, app } = require('electron');
const { URL } = require('url');
const ua = require('universal-analytics');
const jsdom = require('jsdom');
const nodeCrypto = require('crypto');
const { escapeHtml, escapeQuotes, escapeSingleQuotes, sha256hex } = require('./lib/util');
const GitLab = require('./lib/gitlab');
const {
  chevronLgLeftIcon,
  chevronLgLeftIconWithViewboxHack,
  chevronLgRightIcon,
  chevronLgRightIconWithViewboxHack,
  chevronRightIcon,
  externalLinkIcon,
  projectIcon,
  removeIcon,
  todosAllDoneIllustration,
} = require('./src/icons');
const {
  allLabel,
  allText,
  approvalLabel,
  approvalText,
  approvedLabel,
  approvedText,
  assignedLabel,
  assignedText,
  closedLabel,
  closedText,
  createdLabel,
  createdText,
  dueDateLabel,
  dueDateText,
  mergedLabel,
  mergedText,
  openedLabel,
  openedText,
  query,
  recentlyCreatedLabel,
  recentlyCreatedText,
  recentlyUpdatedLabel,
  recentlyUpdatedText,
  reviewedLabel,
  reviewedText,
  sort,
  state,
} = require('./src/filter-text');
const { store, deleteFromStore } = require('./lib/store');
const BrowserHistory = require('./lib/browser-history');
const processInfo = require('./lib/process-info');
const { version } = require('./package.json');
const CommandPalette = require('./src/command-palette');
// eslint-disable-next-line no-shadow
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { JSDOM } = jsdom;
let commandPalette;
global.DOMParser = new JSDOM().window.DOMParser;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let visitor;
if (store.analytics) {
  visitor = ua('UA-203420427-1', store.analytics_id);
}
let recentlyVisitedString = '';
let currentProject;
let moreRecentlyVisitedArray = [];
let recentCommits = [];
let currentCommit;
let lastEventId;
let lastTodoId = -1;
let recentProjectCommits = [];
let currentProjectCommit;
const numberOfRecentlyVisited = 3;
const numberOfFavoriteProjects = 5;
const numberOfRecentComments = 3;
const numberOfIssues = 10;
const numberOfMRs = 10;
const numberOfTodos = 10;
const numberOfComments = 5;
let activeIssuesQueryOption = 'assigned_to_me';
let activeIssuesStateOption = 'opened';
let activeIssuesSortOption = 'created_at';
let activeMRsQueryOption = 'assigned_to_me';
let activeMRsStateOption = 'opened';
let activeMRsSortOption = 'created_at';
let runningPipelineSubscriptions = [];
let runningPipelineSubscriptionInterval = -1;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let isOnSubPage = false;

// Anti rebound variables
const delay = 2000;
let lastUserExecution = 0;
let lastRecentlyVisitedExecution = 0;
let lastLastCommitsExecution = 0;
let lastRecentCommentsExecution = 0;

let lastUserExecutionFinished = true;
let lastRecentlyVisitedExecutionFinished = true;
let lastLastCommitsExecutionFinished = true;
let lastRecentCommentsExecutionFinished = true;

let refreshInProgress = false;

let verifier = '';
let challenge = '';

const mb = menubar({
  showDockIcon: store.show_dock_icon,
  showOnAllWorkspaces: false,
  icon: `${__dirname}/assets/gitlabTemplate.png`,
  preloadWindow: true,
  browserWindow: {
    width: 550,
    height: 700,
    minWidth: 265,
    minHeight: 300,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      nodeIntegration: process.env.NODE_ENV === 'test',
      contextIsolation: process.env.NODE_ENV !== 'test',
      enableRemoteModule: process.env.NODE_ENV === 'test',
    },
    alwaysOnTop: store.keep_visible,
  },
});

const executeUnsafeJavaScript = (js) => mb.window.webContents.executeJavaScript(js);

const setElementHtml = (selector, html) =>
  // This is caused by a Pretter/eslint mismatch
  // eslint-disable-next-line implicit-arrow-linebreak
  executeUnsafeJavaScript(
    `document.querySelector("${escapeQuotes(selector)}").innerHTML = "${escapeQuotes(html).replace(
      /\n/g,
      '\\n',
    )}"`,
  );

// eslint-disable-next-line object-curly-newline
async function callApi(what, options = {}, host = store.host) {
  return new Promise((resolve, reject) => {
    GitLab.get(what, options, host)
      .then((result) => {
        if (result && result.error) {
          // eslint-disable-next-line no-use-before-define
          tryRefresh();
        }
        resolve(result);
      })
      .catch(() => {
        reject();
      });
  });
}

function openSettingsPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/settings').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'Settings');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  const lightString = "'light'";
  const darkString = "'dark'";
  setElementHtml('#detail-headline', '<span class="name">Theme</span>');
  let settingsString = '';
  const theme = `<div id="theme-selection"><div id="light-mode" class="theme-option" onclick="changeTheme(${lightString})"><div class="indicator"></div>Light</div><div id="dark-mode" class="theme-option" onclick="changeTheme(${darkString})"><div class="indicator"></div>Dark</div></div>`;
  if (store.user_id && store.username) {
    const projects = store['favorite-projects'];
    let favoriteProjects =
      '<div class="headline"><span class="name">Favorite projects</span></div><div id="favorite-projects"><ul class="list-container">';
    if (projects && projects.length > 0) {
      projects.forEach((project) => {
        favoriteProjects += `<li>${projectIcon}<div class="name-with-namespace"><span>${escapeHtml(
          project.name,
        )}</span><span class="namespace">${escapeHtml(project.namespace.name)}</span></div>`;
        favoriteProjects += `<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteProject(${project.id})">${removeIcon}</div></div></li>`;
      });
    }
    favoriteProjects += `<li id="add-project-dialog" class="more-link"><a onclick="startProjectDialog()">Add another project ${chevronRightIcon}</a></li></ul></div>`;
    let preferences =
      '<div class="headline"><span class="name">Preferences</span></div><div id="preferences"><form id="prerefences-form">';
    preferences += '<div><input type="checkbox" id="keep-visible" name="keep-visible" ';
    if (store.keep_visible) {
      preferences += ' checked="checked"';
    }
    preferences +=
      'onchange="changeKeepVisible(this.checked)"/><label for="keep-visible">Keep GitDock visible, even when losing focus.</label></div>';
    if (processInfo.platform === 'darwin') {
      preferences += '<div><input type="checkbox" id="show-dock-icon" name="show-dock-icon" ';
      if (store.show_dock_icon) {
        preferences += ' checked="checked"';
      }
      preferences +=
        'onchange="changeShowDockIcon(this.checked)"/><label for="show-dock-icon">Show icon also in dock, not only in menubar.</label></div>';
    }
    preferences += '</form></div>';
    let shortcut =
      '<div class="headline"><span class="name">Command Palette shortcuts</span></div><div id="shortcut"><p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p>';
    if (store.shortcuts) {
      shortcut += '<ul class="list-container">';
      store.shortcuts.forEach((keys) => {
        shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
      });
      shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
    }
    shortcut += '</div>';
    let analyticsString =
      '<div class="headline"><span class="name">Analytics</span></div><div id="analytics">';
    analyticsString +=
      'To better understand how you make use of GitDock features to navigate around your issues, MRs, and other areas, we would love to collect insights about your usage. All data is 100% anonymous and we do not track the specific content (projects, issues...) you are interacting with, only which kind of areas you are using.</div>';
    analyticsString += `<form id="analytics-form"><div><input type="radio" id="analytics-yes" name="analytics" value="yes"${
      store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(true)"><label for="analytics-yes">Yes, collect anonymous data.</label></div><div><input type="radio" id="analytics-no" name="analytics" value="no"${
      !store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(false)"><label for="analytics-no">No, do not collect any data.</label></div></form>`;
    const signout =
      '<div class="headline"><span class="name">User</span></div><div id="user-administration"><button id="logout-button" onclick="logout()">Log out</button></div>';
    settingsString = theme + favoriteProjects + preferences + shortcut + analyticsString + signout;
  } else {
    settingsString = theme;
  }
  setElementHtml('#detail-content', `${settingsString}</div>`);
  executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
  executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
  executeUnsafeJavaScript(`document.getElementById("${store.theme}-mode").classList.add("active")`);
}

function openAboutPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/about').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'About GitDock ⚓️');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  setElementHtml('#detail-headline', '<span class="name">About GitDock ⚓️</span>');
  let aboutString =
    '<p>GitDock is a MacOS/Windows/Linux app that displays all your GitLab activities in one place. Instead of the GitLab typical project- or group-centric approach, it collects all your information from a user-centric perspective.</p>';
  aboutString +=
    '<p>If you want to learn more about why we built this app, you can have a look at our <a href="https://about.gitlab.com/blog/2021/10/05/gitpod-desktop-app-personal-activities" target="_blank">blog post</a>.</p>';
  aboutString +=
    '<p>We use issues to collect bugs, feature requests, and more. You can <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues" target="_blank">browse through existing issues</a>. To report a bug, suggest an improvement, or propose a feature, please <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues/new">create a new issue</a> if there is not already an issue for it.</p>';
  aboutString +=
    '<p>If you are thinking about contributing directly, check out our <a href="https://gitlab.com/mvanremmerden/gitdock/-/blob/main/CONTRIBUTING.md" target="_blank">contribution guidelines</a>.</p>';
  aboutString += `<p class="version-number">Version ${version}</p>`;
  setElementHtml('#detail-content', `${aboutString}</div>`);
}

function setupLinuxContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GitDock',
      click: () => mb.showWindow(),
      visible: processInfo.platform === 'linux',
    },
    ...baseMenuItems,
  ]);

  mb.tray.setContextMenu(menu);
}

function setupGenericContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate(baseMenuItems);

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(menu);
  });
}

function setupContextMenu() {
  const baseMenuItems = [
    {
      label: 'Settings',
      click: () => {
        openSettingsPage();
      },
    },
    {
      label: 'About',
      click: () => {
        openAboutPage();
      },
    },
    {
      label: 'Quit',
      click: () => {
        mb.app.quit();
      },
    },
  ];

  if (processInfo.platform === 'linux') {
    setupLinuxContextMenu(baseMenuItems);
  } else {
    setupGenericContextMenu(baseMenuItems);
  }
}

function setupCommandPalette() {
  if (!commandPalette) {
    commandPalette = new CommandPalette();
  }

  commandPalette.register({
    shortcut: store.shortcuts,
  });
}

function chooseCertificate() {
  mb.window.setAlwaysOnTop(true);
  const filepaths = dialog.showOpenDialogSync();
  setTimeout(() => {
    mb.window.setAlwaysOnTop(false);
  }, 200);
  if (filepaths) {
    const filepath = filepaths[0].replace(/\\/g, '/'); // convert \ to / otherwise separators get lost on windows
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-button").classList.add("hidden")',
    );
    executeUnsafeJavaScript(
      `document.getElementById("custom-cert-path-text").innerText="${filepath}"`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-text").classList.remove("hidden")',
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-reset").classList.remove("hidden")',
    );
  }
}

function repaintShortcuts() {
  let shortcut =
    '<p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p><ul class="list-container">';
  if (store.shortcuts) {
    store.shortcuts.forEach((keys) => {
      shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
    });
    shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
  }
  shortcut += '</div>';
  setElementHtml('#shortcut', shortcut);
}

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function timeSince(date, direction = 'since') {
  let seconds;
  if (direction === 'since') {
    seconds = Math.floor((new Date() - date) / 1000);
  } else if (direction === 'to') {
    seconds = Math.floor((date - new Date()) / 1000);
  }
  let interval = seconds / 31536000;
  if (interval >= 2) {
    return `${Math.floor(interval)} years`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} year`;
  }
  interval = seconds / 2592000;
  if (interval > 2) {
    return `${Math.floor(interval)} months`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} month`;
  }
  interval = seconds / 604800;
  if (interval > 2) {
    return `${Math.floor(interval)} weeks`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} week`;
  }
  interval = seconds / 86400;
  if (interval > 2) {
    return `${Math.floor(interval)} days`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} day`;
  }
  interval = seconds / 3600;
  if (interval >= 2) {
    return `${Math.floor(interval)} hours`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} hour`;
  }
  interval = seconds / 60;
  if (interval > 2) {
    return `${Math.floor(interval)} minutes`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} minute`;
  }
  return `${Math.floor(seconds)} seconds`;
}

function logout() {
  deleteFromStore('user_id');
  deleteFromStore('username');
  deleteFromStore('access_token');
  deleteFromStore('custom_cert_path');
  deleteFromStore('host');
  deleteFromStore('plan');
  mb.window.webContents.session.clearCache();
  mb.window.webContents.session.clearStorageData();
  app.quit();
  app.relaunch();
}

function displayUsersProjects() {
  let favoriteProjectsHtml = '';
  const projects = store['favorite-projects'];
  if (projects && projects.length > 0) {
    favoriteProjectsHtml += '<ul class="list-container clickable" data-testid="favorite-projects">';
    const chevron = chevronLgRightIcon;
    projects.forEach((projectObject) => {
      const projectString = "'Project'";
      const jsonProjectObject = JSON.parse(JSON.stringify(projectObject));
      jsonProjectObject.name_with_namespace = projectObject.name_with_namespace;
      jsonProjectObject.namespace.name = projectObject.namespace.name;
      jsonProjectObject.name = projectObject.name;
      const projectJson = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
      favoriteProjectsHtml += `<li onclick="goToDetail(${projectString}, ${projectJson})">${projectIcon}`;
      favoriteProjectsHtml += `<div class="name-with-namespace"><span>${escapeHtml(
        projectObject.name,
      )}</span><span class="namespace">${escapeHtml(
        projectObject.namespace.name,
      )}</span></div><div class="chevron-right-wrapper">${chevron}</div></li>`;
    });
    favoriteProjectsHtml += '</ul>';
  } else {
    const projectLink = "'project-overview-link'";
    favoriteProjectsHtml = `<div class="new-project"><div><span class="cta">Track projects you care about</span> 🌟</div><div class="cta-description">Add any project you want a directly accessible shortcut for.</div><form class="project-input" action="#" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-overview-link" placeholder="Enter the project link here..." /><button class="add-button" id="project-overview-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-overview-error"></div></div>`;
  }
  setElementHtml('#projects', favoriteProjectsHtml);
}

async function getUsersProjects() {
  const projects = await callApi(`users/${store.user_id}/starred_projects`, {
    min_access_level: 30,
    per_page: numberOfFavoriteProjects,
    order_by: 'updated_at',
  });
  if (projects) {
    return projects.map((project) => ({
      id: project.id,
      visibility: project.visibility,
      web_url: project.web_url,
      name: project.name,
      namespace: {
        name: project.namespace.name,
      },
      added: Date.now(),
      name_with_namespace: project.name_with_namespace,
      open_issues_count: project.open_issues_count,
      last_activity_at: project.last_activity_at,
      avatar_url: project.avatar_url,
      star_count: project.star_count,
      forks_count: project.forks_count,
    }));
  }
  return false;
}

function getBookmarks() {
  const { bookmarks } = store;
  let bookmarksString = '';
  if (bookmarks && bookmarks.length > 0) {
    bookmarksString = '<ul class="list-container">';
    bookmarks.forEach((bookmark) => {
      let namespaceLink = '';
      if (bookmark.parent_name && bookmark.parent_url) {
        namespaceLink = ` &middot; <a href="${bookmark.parent_url}" target="_blank">${escapeHtml(
          bookmark.parent_name,
        )}</a>`;
      }

      let { title } = bookmark;

      if (bookmark.id && ['merge_requests', 'issues'].includes(bookmark.type)) {
        const typeIndicator = GitLab.indicatorForType(bookmark.type);
        title += ` (${typeIndicator}${bookmark.id})`;
      }

      bookmarksString += `<li class="history-entry bookmark-entry"><div class="bookmark-information"><a href="${escapeSingleQuotes(
        escapeHtml(bookmark.web_url),
      )}" id="bookmark-title" target="_blank">${escapeHtml(
        title,
      )}</a><span class="namespace-with-time">Added ${timeSince(
        bookmark.added,
      )} ago${namespaceLink}</span></div><div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteBookmark('${sha256hex(
        bookmark.web_url,
      )}')">${removeIcon}</div></div></li>`;
    });
    bookmarksString += `<li id="add-bookmark-dialog" class="more-link"><a onclick="startBookmarkDialog()">Add another bookmark ${chevronRightIcon}</a></li></ul>`;
  } else {
    const bookmarkLink = "'bookmark-link'";
    bookmarksString = `<div id="new-bookmark"><div><span class="cta">Add a new GitLab bookmark</span> 🔖</div><div class="cta-description">Bookmarks are helpful when you have an issue/merge request you will have to come back to repeatedly.</div><form id="bookmark-input" action="#" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter the link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div></div>`;
  }
  setElementHtml('#bookmarks', bookmarksString);
}

async function getRecentlyVisited() {
  if (lastRecentlyVisitedExecutionFinished && lastRecentlyVisitedExecution + delay < Date.now()) {
    lastRecentlyVisitedExecutionFinished = false;
    const recentlyVisitedArray = [];
    recentlyVisitedString = '';
    let firstItem = true;
    await BrowserHistory.getAllHistory().then(async (history) => {
      const item = Array.prototype.concat.apply([], history);
      item.sort((a, b) => {
        if (a.utc_time > b.utc_time) {
          return -1;
        }
        if (b.utc_time > a.utc_time) {
          return 1;
        }
        return -1;
      });
      let i = 0;
      for (let j = 0; j < item.length; j += 1) {
        if (
          item[j].title &&
          item[j].url.indexOf(`${store.host}/`) === 0 &&
          (item[j].url.indexOf('/-/issues/') !== -1 ||
            item[j].url.indexOf('/-/merge_requests/') !== -1 ||
            item[j].url.indexOf('/-/epics/') !== -1) &&
          !recentlyVisitedArray.includes(item[j].title) &&
          item[j].title.split('·')[0] !== 'Not Found' &&
          item[j].title.split('·')[0] !== 'New Issue ' &&
          item[j].title.split('·')[0] !== 'New Merge Request ' &&
          item[j].title.split('·')[0] !== 'New merge request ' &&
          item[j].title.split('·')[0] !== 'New Epic ' &&
          item[j].title.split('·')[0] !== 'Edit ' &&
          item[j].title.split('·')[0] !== 'Merge requests ' &&
          item[j].title.split('·')[0] !== 'Issues '
        ) {
          if (firstItem) {
            recentlyVisitedString = '<ul class="list-container">';
            firstItem = false;
          }
          const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
          if (nameWithNamespace.split('/')[0] !== 'groups') {
            item.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
              nameWithNamespace.split('/')[1]
            }?access_token=${store.access_token}`;
          } else {
            item.url = `${store.host}/api/v4/groups/${
              nameWithNamespace.split('/')[0]
            }?access_token=${store.access_token}`;
          }
          recentlyVisitedArray.push(item[j].title);
          if (item[j].title !== 'Checking your Browser - GitLab') {
            recentlyVisitedString += '<li class="history-entry">';
            recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
              item[j].title.split('·')[0],
            )}</a><span class="namespace-with-time">${timeSince(
              new Date(`${item[j].utc_time} UTC`),
            )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
              item[j].title.split('·')[2].trim(),
            )}</a></span></div></li>`;
            i += 1;
            if (i === numberOfRecentlyVisited) {
              break;
            }
          }
        }
      }
      if (!firstItem) {
        const moreString = "'Recently viewed'";
        recentlyVisitedString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
      } else if (BrowserHistory.isSupported()) {
        recentlyVisitedString = `<p class="no-results">Recently visited objects will show up here.<br/><span class="supported-browsers">Supported browsers: ${BrowserHistory.supportedBrowserNames()}.</span></p>`;
      } else {
        recentlyVisitedString =
          '<p class="no-results"><span class="supported-browsers">No browsers are supported on your operating system yet.</span></p>';
      }
      setElementHtml('#history', recentlyVisitedString);
      lastRecentlyVisitedExecution = Date.now();
      lastRecentlyVisitedExecutionFinished = true;
    });
  }
}

async function subscribeToRunningPipeline() {
  if (runningPipelineSubscriptionInterval !== -1) {
    clearInterval(runningPipelineSubscriptionInterval);
  }
  runningPipelineSubscriptionInterval = setInterval(async () => {
    runningPipelineSubscriptions.forEach(async (runningPipeline) => {
      const pipeline = await callApi(
        `projects/${runningPipeline.project_id}/pipelines/${runningPipeline.id}`,
      );
      if (pipeline) {
        let pipelineStatus;
        if (pipeline.status !== 'running') {
          if (pipeline.status === 'success') {
            pipelineStatus = 'succeeded';
          } else {
            pipelineStatus = pipeline.status;
          }
          const updateNotification = new Notification({
            title: `Pipeline ${pipelineStatus}`,
            subtitle: GitLab.fetchUrlInfo(pipeline.web_url).namespaceWithProject,
            body: runningPipeline.commit_title,
          });
          updateNotification.on('click', () => {
            shell.openExternal(pipeline.web_url);
          });
          updateNotification.show();
          runningPipelineSubscriptions = runningPipelineSubscriptions.filter(
            (subscriptionPipeline) => subscriptionPipeline.id !== pipeline.id,
          );
          if (runningPipelineSubscriptions.length === 0) {
            clearInterval(runningPipelineSubscriptionInterval);
            runningPipelineSubscriptionInterval = -1;
            mb.tray.setImage(`${__dirname}/assets/gitlabTemplate.png`);
          }
        }
      }
    });
  }, 10000);
}

async function getLastPipelines(commits) {
  const projectArray = [];
  if (commits && commits.length > 0) {
    commits.forEach(async (commit) => {
      if (!projectArray.includes(commit.project_id)) {
        projectArray.push(commit.project_id);
        const pipelines = await callApi(`projects/${commit.project_id}/pipelines`, {
          status: 'running',
          username: store.username,
          per_page: 1,
          page: 1,
        });
        if (pipelines && pipelines.length > 0) {
          mb.tray.setImage(`${__dirname}/assets/runningTemplate.png`);
          pipelines.forEach(async (pipeline) => {
            const commitPipeline = pipeline;
            if (
              runningPipelineSubscriptions.findIndex(
                (subscriptionPipeline) => subscriptionPipeline.id === pipeline.id,
              ) === -1
            ) {
              const pipelineCommit = await callApi(
                `projects/${pipeline.project_id}/repository/commits/${pipeline.sha}`,
              );
              if (pipelineCommit) {
                commitPipeline.commit_title = pipelineCommit.title;
                runningPipelineSubscriptions.push(commitPipeline);
                const runningNotification = new Notification({
                  title: 'Pipeline running',
                  subtitle: GitLab.fetchUrlInfo(commitPipeline.web_url).namespaceWithProject,
                  body: commitPipeline.commit_title,
                });
                runningNotification.on('click', () => {
                  shell.openExternal(commitPipeline.web_url);
                });
                runningNotification.show();
              }
            }
          });
          subscribeToRunningPipeline();
        }
      }
    });
  }
}

function displayAddError(type, target, customMessage) {
  executeUnsafeJavaScript(
    `document.getElementById("add-${type}${target}error").style.display = "block"`,
  );
  if (customMessage) {
    setElementHtml(`#add-${type}${target}error`, customMessage);
  } else {
    setElementHtml(`#add-${type}${target}error`, `This is not a valid GitLab ${type} URL.`);
  }
  executeUnsafeJavaScript(`document.getElementById("${type}${target}add-button").disabled = false`);
  executeUnsafeJavaScript(`document.getElementById("${type}${target}link").disabled = false`);
  setElementHtml(`#${type}${target}add-button`, 'Add');
}

function displayPagination(keysetLinks, type) {
  let paginationString = '';
  if (keysetLinks.indexOf('rel="next"') !== -1 || keysetLinks.indexOf('rel="prev"') !== -1) {
    paginationString += '<div id="pagination">';
    if (keysetLinks.indexOf('rel="prev"') !== -1) {
      let prevLink = '';
      prevLink = escapeHtml(`"${keysetLinks.split('>; rel="prev"')[0].substring(1)}"`);
      paginationString += `<button onclick="switchPage(${prevLink}, ${type})" class="prev">${chevronLgLeftIcon} Previous</button>`;
    } else {
      paginationString += '<div></div>';
    }
    if (keysetLinks.indexOf('rel="next"') !== -1) {
      let nextLink = '';
      if (keysetLinks.indexOf('rel="prev"') !== -1) {
        nextLink = escapeHtml(
          `"${keysetLinks.split('rel="prev", ')[1].split('>; rel="next"')[0].substring(1)}"`,
        );
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      } else {
        nextLink = escapeHtml(`"${keysetLinks.split('>; rel="next"')[0].substring(1)}"`);
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      }
    } else {
      paginationString += '<div></div>';
    }
    paginationString += '</div>';
  }
  return paginationString;
}

function renderCollabject(comment, collabject) {
  const collabObject = collabject;
  if (collabObject.message && collabObject.message === '404 Not found') {
    return 0;
  }
  if (comment.note.noteable_type === 'DesignManagement::Design') {
    collabObject.web_url += `/designs/${comment.target_title}`;
    return `<li class="comment"><a href="${collabObject.web_url}#note_${
      comment.note.id
    }" target="_blank">${escapeHtml(
      comment.note.body,
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(comment.created_at),
    )} ago &middot; <a href="${
      collabObject.web_url.split('#note')[0]
    }" target="_blank">${escapeHtml(comment.target_title)}</a></span></div></li>`;
  }
  return `<li class="comment"><a href="${collabObject.web_url}#note_${
    comment.note.id
  }" target="_blank">${escapeHtml(
    comment.note.body,
  )}</a><span class="namespace-with-time">${timeSince(
    new Date(comment.created_at),
  )} ago &middot; <a href="${collabObject.web_url.split('#note')[0]}" target="_blank">${escapeHtml(
    comment.target_title,
  )}</a></span></div></li>`;
}

function displayCommit(commit, project, focus = 'project') {
  let logo = '';
  if (commit.last_pipeline) {
    logo += `<a target="_blank" href="${commit.last_pipeline.web_url}" class="pipeline-link">`;
    if (commit.last_pipeline.status === 'scheduled') {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7"/><circle class="icon" style="fill: var(--svg-status-bg, #c9d1d9);" cx="7" cy="7" r="6"/><g transform="translate(2.75 2.75)" fill-rule="nonzero"><path d="M4.165 7.81a3.644 3.644 0 1 1 0-7.29 3.644 3.644 0 0 1 0 7.29zm0-1.042a2.603 2.603 0 1 0 0-5.206 2.603 2.603 0 0 0 0 5.206z"/><rect x="3.644" y="2.083" width="1.041" height="2.603" rx=".488"/><rect x="3.644" y="3.644" width="2.083" height="1.041" rx=".488"/></g></svg>';
    } else {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="M0 7a7 7 0 1 1 14 0A7 7 0 0 1 0 7z" class="icon"/><path d="M13 7A6 6 0 1 0 1 7a6 6 0 0 0 12 0z" class="icon-inverse" />';
      if (commit.last_pipeline.status === 'running') {
        logo +=
          '<path d="M7 3c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.3 0-2.5-.7-3.3-1.7L7 7V3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'failed') {
        logo +=
          '<path d="M7 5.969L5.599 4.568a.29.29 0 0 0-.413.004l-.614.614a.294.294 0 0 0-.004.413L5.968 7l-1.4 1.401a.29.29 0 0 0 .004.413l.614.614c.113.114.3.117.413.004L7 8.032l1.401 1.4a.29.29 0 0 0 .413-.004l.614-.614a.294.294 0 0 0 .004-.413L8.032 7l1.4-1.401a.29.29 0 0 0-.004-.413l-.614-.614a.294.294 0 0 0-.413-.004L7 5.968z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'success') {
        logo +=
          '<path d="M6.278 7.697L5.045 6.464a.296.296 0 0 0-.42-.002l-.613.614a.298.298 0 0 0 .002.42l1.91 1.909a.5.5 0 0 0 .703.005l.265-.265L9.997 6.04a.291.291 0 0 0-.009-.408l-.614-.614a.29.29 0 0 0-.408-.009L6.278 7.697z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'pending') {
        logo +=
          '<path d="M4.7 5.3c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H5c-.2 0-.3-.1-.3-.3V5.3m3 0c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H8c-.2 0-.3-.1-.3-.3V5.3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'canceled') {
        logo +=
          '<path d="M5.2 3.8l4.9 4.9c.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0L3.8 5.2c-.2-.2-.2-.5 0-.7l.7-.7c.2-.2.5-.2.7 0" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'skipped') {
        logo +=
          '<path d="M6.415 7.04L4.579 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L5.341 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L6.415 7.04zm2.54 0L7.119 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L7.881 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L8.955 7.04z" class="icon"/></svg>';
      } else if (commit.last_pipeline.status === 'created') {
        logo += '<circle cx="7" cy="7" r="3.25" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'preparing') {
        logo +=
          '</g><circle cx="7" cy="7" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="4" cy="7" r="1"/></g></svg>';
      } else if (commit.last_pipeline.status === 'manual') {
        logo +=
          '<path d="M10.5 7.63V6.37l-.787-.13c-.044-.175-.132-.349-.263-.61l.481-.652-.918-.913-.657.478a2.346 2.346 0 0 0-.612-.26L7.656 3.5H6.388l-.132.783c-.219.043-.394.13-.612.26l-.657-.478-.918.913.437.652c-.131.218-.175.392-.262.61l-.744.086v1.261l.787.13c.044.218.132.392.263.61l-.438.651.92.913.655-.434c.175.086.394.173.613.26l.131.783h1.313l.131-.783c.219-.043.394-.13.613-.26l.656.478.918-.913-.48-.652c.13-.218.218-.435.262-.61l.656-.13zM7 8.283a1.285 1.285 0 0 1-1.313-1.305c0-.739.57-1.304 1.313-1.304.744 0 1.313.565 1.313 1.304 0 .74-.57 1.305-1.313 1.305z" class="icon"/></g></svg>';
      }
    }
  }
  logo += '</a>';
  let subline;
  if (focus === 'project') {
    subline = `<a href="${project.web_url}" target=_blank">${escapeHtml(
      project.name_with_namespace,
    )}</a>`;
  } else {
    subline = escapeHtml(commit.author_name);
  }
  return `<div class="commit"><div class="commit-information"><a href="${
    commit.web_url
  }" target="_blank">${escapeHtml(commit.title)}</a><span class="namespace-with-time">${timeSince(
    new Date(commit.committed_date),
  )} ago &middot; ${subline}</span></div>${logo}</div>`;
}

function renderNoCommitsPushedYetMessage() {
  executeUnsafeJavaScript('document.getElementById("commits-pagination").classList.add("hidden")');
  setElementHtml('#pipeline', '<p class="no-results">You haven&#039;t pushed any commits yet.</p>');
}

async function getCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("commits-pagination").classList.remove("hidden")',
  );
  executeUnsafeJavaScript('document.getElementById("commits-count").classList.remove("empty")');
  setElementHtml('#commits-count', `${index}/${recentCommits.length}`);
  const project = await callApi(`projects/${projectId}`);
  const commit = await callApi(`projects/${project.id}/repository/commits/${sha}`);
  if (project && commit) {
    setElementHtml('#pipeline', displayCommit(commit, project));
  }
}

async function getLastCommits(count = 20) {
  if (lastLastCommitsExecutionFinished && lastLastCommitsExecution + delay < Date.now()) {
    lastLastCommitsExecutionFinished = false;

    const commits = await callApi('events', {
      action: 'pushed',
      per_page: count,
    });
    if (commits && Array.isArray(commits) && !commits.error) {
      if (commits && commits.length > 0) {
        lastEventId = commits[0].id;
        getLastPipelines(commits);
        const committedArray = commits.filter(
          /* eslint-disable implicit-arrow-linebreak */
          (commit) =>
            commit.action_name === 'pushed to' ||
            (commit.action_name === 'pushed new' &&
              commit.push_data.commit_to &&
              commit.push_data.commit_count > 0),
          /* eslint-enable */
        );
        if (committedArray && committedArray.length > 0) {
          [currentCommit] = committedArray;
          recentCommits = committedArray;
          getCommitDetails(committedArray[0].project_id, committedArray[0].push_data.commit_to, 1);
        } else {
          renderNoCommitsPushedYetMessage();
        }
      } else {
        renderNoCommitsPushedYetMessage();
      }
    }
    lastLastCommitsExecution = Date.now();
    lastLastCommitsExecutionFinished = true;
  }
}

async function getRecentComments() {
  if (lastRecentCommentsExecutionFinished && lastRecentCommentsExecution + delay < Date.now()) {
    lastRecentCommentsExecutionFinished = false;
    let recentCommentsString = '';

    const comments = await callApi('events', {
      action: 'commented',
      per_page: numberOfRecentComments,
    });
    if (comments && Array.isArray(comments) && !comments.error) {
      if (comments && comments.length > 0) {
        recentCommentsString += '<ul class="list-container">';
        /* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop */
        for (const comment of comments) {
          const path = GitLab.commentToNoteableUrl(comment);

          if (!path) {
            continue;
          }

          const collabject = await callApi(path);
          if (collabject) {
            recentCommentsString += renderCollabject(comment, collabject);
          }
        }
        // eslint-disable no-restricted-syntax */
        const moreString = "'Comments'";
        recentCommentsString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
        setElementHtml('#comments', recentCommentsString);
      } else {
        setElementHtml(
          '#comments',
          '<p class="no-results">You haven&#039;t written any comments yet.</p>',
        );
      }
    }
    lastRecentCommentsExecution = Date.now();
    lastRecentCommentsExecutionFinished = true;
  }
}

async function getLastEvent() {
  if (!recentCommits || recentCommits.length === 0) {
    return;
  }
  const lastEvent = await callApi('events', {
    action: 'pushed',
    per_page: 1,
  });
  if (lastEvent && lastEvent.id !== lastEventId) {
    lastEventId = lastEvent.id;
    getLastCommits();
    getRecentComments();
  }
}

async function getLastTodo() {
  const todo = await callApi('todos', {
    per_page: 1,
  });
  if (todo && lastTodoId !== todo.id) {
    if (lastTodoId !== -1 && Date.parse(todo.created_at) > Date.now() - 20000) {
      const todoNotification = new Notification({
        title: todo.body,
        subtitle: todo.author.name,
        body: todo.target.title,
      });
      todoNotification.on('click', () => {
        shell.openExternal(todo.target_url);
      });
      todoNotification.show();
    }
    lastTodoId = todo.id;
  }
}

async function getUser() {
  if (lastUserExecutionFinished && lastUserExecution + delay < Date.now()) {
    lastUserExecutionFinished = false;

    const user = await callApi('user');
    if (user && !user.error) {
      let avatarUrl;
      if (user.avatar_url) {
        avatarUrl = new URL(user.avatar_url);
        if (avatarUrl.host !== 'secure.gravatar.com') {
          avatarUrl.href += '?width=64';
        }
      }
      const userHtml = `<a href="${user.web_url}" target="_blank"><img src="${
        avatarUrl.href
      }" /><div class="user-information"><span class="user-name">${escapeHtml(
        user.name,
      )}</span><span class="username">@${escapeHtml(user.username)}</span></div></a>`;
      setElementHtml('#user', userHtml);
      lastUserExecution = Date.now();
      lastUserExecutionFinished = true;
    }
  }
}

function tryRefresh() {
  if (!refreshInProgress) {
    refreshInProgress = true;
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        refresh_token: store.refresh_token,
        grant_type: 'refresh_token',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        if (result.access_token && result.refresh_token) {
          store.access_token = result.access_token;
          store.refresh_token = result.refresh_token;
          lastUserExecution = 0;
          lastLastCommitsExecution = 0;
          lastRecentCommentsExecution = 0;

          lastUserExecutionFinished = true;
          lastLastCommitsExecutionFinished = true;
          lastRecentCommentsExecutionFinished = true;

          getUser();
          getLastTodo();
          getLastCommits();
          getRecentComments();
        } else {
          logout();
        }
        refreshInProgress = false;
      })
      .catch(() => {
        refreshInProgress = false;
        logout();
      });
  }
}

async function saveUser(
  accessToken,
  url = store.host,
  customCertPath = undefined,
  refreshToken = undefined,
) {
  try {
    if (url.endsWith('/')) {
      /* eslint-disable no-param-reassign */
      url = url.substring(0, url.length - 1);
    }
    /* eslint-disable operator-linebreak, object-curly-newline */
    const options = customCertPath
      ? { access_token: accessToken, custom_cert_path: customCertPath }
      : { access_token: accessToken };
    /* eslint-enable */
    const result = await callApi('user', options, url);
    if (result && result.id && result.username) {
      store.access_token = accessToken;
      store.user_id = result.id;
      store.username = result.username;
      store.host = url;
      if (refreshToken) {
        store.refresh_token = refreshToken;
      }
      if (customCertPath) {
        store.custom_cert_path = customCertPath;
      }
      getUsersProjects().then(async (projects) => {
        if (
          store['favorite-projects'] &&
          store['favorite-projects'].length === 0 &&
          projects &&
          projects.length > 0
        ) {
          store['favorite-projects'] = projects;
        }
        // eslint-disable-next-line no-use-before-define
        mb.window.removeListener('page-title-updated', handleLogin);
        await mb.window
          .loadURL(`file://${__dirname}/index.html`)
          .then(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          })
          .catch(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          });
      });
    }
  } catch (e) {
    throw new Error(e);
  }
}

function handleLogin() {
  if (mb.window.webContents.getURL().indexOf('?code=') !== -1) {
    const code = mb.window.webContents.getURL().split('?code=')[1].replace('&state=test', '');
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
        code_verifier: verifier,
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        saveUser(result.access_token, 'https://gitlab.com', undefined, result.refresh_token);
      });
  }
}

async function startLogin() {
  verifier = base64URLEncode(nodeCrypto.randomBytes(32));
  challenge = base64URLEncode(sha256(verifier));
  await mb.window.loadURL(
    `${store.host}/oauth/authorize?client_id=2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee&redirect_uri=https://mvanremmerden.gitlab.io/gitdock-login/&response_type=code&state=test&scope=read_api&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  mb.window.on('page-title-updated', handleLogin);
  mb.showWindow();
}

async function getUsersPlan() {
  let userNamespace;
  const namespaces = await callApi('namespaces');
  if (namespaces && namespaces.length > 0) {
    userNamespace = namespaces.find((namespace) => namespace.kind === 'user');
  }

  store.plan = userNamespace && userNamespace.plan ? userNamespace.plan : 'free';
}

async function getProjectCommits(project, count = 20) {
  const commits = await callApi(`projects/${project.id}/repository/commits`, {
    per_page: count,
  });
  if (commits && commits.length > 0) {
    recentProjectCommits = commits;
    [currentProjectCommit] = commits;

    const commit = await callApi(`projects/${project.id}/repository/commits/${commits[0].id}`, {
      per_page: count,
    });
    if (commit) {
      const pagination = `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="project-commits-count">1/${recentProjectCommits.length}</span><button onclick="changeProjectCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeProjectCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`;
      setElementHtml('#detail-headline', pagination);
      setElementHtml('#project-pipeline', displayCommit(commit, project, 'author'));
    }
  } else {
    setElementHtml('#project-commits-pagination', '<span class="name">Commits</span>');
    setElementHtml('#project-pipeline', '<p class="no-results">No commits pushed yet.</p>');
  }
}

function changeCommit(forward, commitArray, chosenCommit) {
  let nextCommit;
  let index = commitArray.findIndex((commit) => commit.id === chosenCommit.id);
  if (forward) {
    if (index === commitArray.length - 1) {
      [nextCommit] = commitArray;
      index = 1;
    } else {
      nextCommit = commitArray[index + 1];
      index += 2;
    }
  } else if (index === 0) {
    nextCommit = commitArray[commitArray.length - 1];
    index = commitArray.length;
  } else {
    nextCommit = commitArray[index - 1];
  }
  nextCommit.index = index;
  return nextCommit;
}

async function getProjectCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("project-commits-count").classList.remove("empty")',
  );
  setElementHtml('#project-commits-count', `${index}/${recentProjectCommits.length}`);

  const commit = await callApi(`projects/${projectId}/repository/commits/${sha}`);
  if (commit) {
    setElementHtml('#project-pipeline', displayCommit(commit, currentProject, 'author'));
  }
}

async function getMoreRecentlyVisited() {
  recentlyVisitedString = '';
  let firstItem = true;
  await BrowserHistory.getAllHistory().then(async (history) => {
    const item = Array.prototype.concat.apply([], history);
    item.sort((a, b) => {
      if (a.utc_time > b.utc_time) {
        return -1;
      }
      if (b.utc_time > a.utc_time) {
        return 1;
      }
      return -1;
    });
    setElementHtml(
      '#detail-headline',
      '<input id="recentSearch" type="text" onkeyup="searchRecent(this)" placeholder="Search..." />',
    );

    let previousDate = 0;
    for (let j = 0; j < item.length; j += 1) {
      const { title } = item[j];
      let { url } = item[j];
      const isHostUrl = url.startsWith(`${store.host}/`);
      const isIssuable =
        url.includes('/-/issues/') ||
        url.includes('/-/merge_requests/') ||
        url.includes('/-/epics/');
      const wasNotProcessed = !moreRecentlyVisitedArray.some((object) => object.title === title);
      const ignoredTitlePrefixes = [
        'Not Found',
        'New Issue',
        'New Merge Request',
        'New merge request',
        'New Epic',
        'Edit',
        'Merge Conflicts',
        'Merge requests',
        'Issues',
        '500 Error - GitLab',
        'Checking your Browser - GitLab',
      ];
      const titlePrefix = (title || '').split('·')[0].trim();
      if (
        title &&
        isHostUrl &&
        isIssuable &&
        wasNotProcessed &&
        !ignoredTitlePrefixes.includes(titlePrefix)
      ) {
        const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
        if (nameWithNamespace.split('/')[0] !== 'groups') {
          url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
            nameWithNamespace.split('/')[1]
          }?access_token=${store.access_token}`;
        } else {
          url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
            store.access_token
          }`;
        }
        const currentDate = new Date(item[j].utc_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: timezone,
        });
        if (previousDate !== currentDate) {
          if (
            currentDate ===
            new Date(Date.now()).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              timeZone: timezone,
            })
          ) {
            recentlyVisitedString += '<div class="date">Today</div>';
          } else {
            if (!firstItem) {
              recentlyVisitedString += '</ul>';
            }
            recentlyVisitedString += `<div class="date">${currentDate}</div>`;
          }
          recentlyVisitedString += '<ul class="list-container history-list-container">';
          previousDate = currentDate;
        }
        moreRecentlyVisitedArray.push(item[j]);
        recentlyVisitedString += '<li class="history-entry">';
        recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
          item[j].title.split('·')[0],
        )}</a><span class="namespace-with-time">${timeSince(
          new Date(`${item[j].utc_time} UTC`),
        )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
          item[j].title.split('·')[2].trim(),
        )}</a></span></div></li>`;
        firstItem = false;
      }
    }
    recentlyVisitedString += '</ul>';
    setElementHtml('#detail-content', recentlyVisitedString);
  });
}

function searchRecentlyVisited(searchterm) {
  /* eslint-disable implicit-arrow-linebreak, function-paren-newline */
  const foundArray = moreRecentlyVisitedArray.filter((item) =>
    item.title.toLowerCase().includes(searchterm),
  );
  /* eslint-enable */
  let foundString = '<ul class="list-container">';
  foundArray.forEach((item) => {
    const object = item;
    const nameWithNamespace = object.url.replace(`${store.host}/`, '').split('/-/')[0];
    if (nameWithNamespace.split('/')[0] !== 'groups') {
      object.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
        nameWithNamespace.split('/')[1]
      }?access_token=${store.access_token}`;
    } else {
      object.url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
        store.access_token
      }`;
    }
    foundString += '<li class="history-entry">';
    foundString += `<a href="${object.url}" target="_blank">${escapeHtml(
      object.title.split('·')[0],
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(`${object.utc_time} UTC`),
    )} ago &middot; <a href="${object.url.split('/-/')[0]}" target="_blank">${escapeHtml(
      object.title.split('·')[2].trim(),
    )}</a></span></div></li>`;
  });
  foundString += '</ul>';
  setElementHtml('#detail-content', foundString);
}

function getMoreRecentComments(
  url = `${store.host}/api/v4/events?action=commented&per_page=${numberOfComments}&access_token=${store.access_token}`,
) {
  let recentCommentsString = '<ul class="list-container">';
  const type = "'Comments'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then(async (comments) => {
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const comment of comments) {
        const path = GitLab.commentToNoteableUrl(comment);
        const collabject = await callApi(path);
        if (collabject) {
          recentCommentsString += renderCollabject(comment, collabject);
        }
      }
      /* eslint-enable */
      recentCommentsString += `</ul>${displayPagination(keysetLinks, type)}`;
      setElementHtml('#detail-content', recentCommentsString);
    });
}

function getIssues(
  url = `${store.host}/api/v4/issues?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let issuesString = '';
  const type = "'Issues'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((issues) => {
      if (issues && issues.length > 0) {
        issuesString += '<ul class="list-container">';
        issues.forEach((issue) => {
          let timestamp;
          if (activeIssuesSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(issue.updated_at))} ago`;
          } else if (activeIssuesSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(issue.created_at))} ago`;
          } else if (activeIssuesSortOption === 'due_date&sort=asc') {
            if (!issue.due_date) {
              timestamp = 'No due date';
            } else if (new Date() > new Date(issue.due_date)) {
              timestamp = `Due ${timeSince(new Date(issue.due_date))} ago`;
            } else {
              timestamp = `Due in ${timeSince(new Date(issue.due_date), 'to')}`;
            }
          }
          issuesString += '<li class="history-entry">';
          issuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
            issue.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            issue.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(
            issue.references.full.split('#')[0],
          )}</a></span></div></li>`;
        });
        issuesString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        issuesString = `<div class="zero">${illustration}<p>No issues with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, issuesString);
    });
}

function getMRs(
  url = `${store.host}/api/v4/merge_requests?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let mrsString = '';
  const type = "'MRs'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((mrs) => {
      if (mrs && mrs.length > 0) {
        mrsString = '<ul class="list-container">';
        mrs.forEach((mr) => {
          let timestamp;
          if (activeMRsSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(mr.updated_at))} ago`;
          } else if (activeMRsSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(mr.created_at))} ago`;
          }
          mrsString += '<li class="history-entry">';
          mrsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
            mr.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            mr.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(mr.references.full.split('!')[0])}</a></span></div></li>`;
        });
        mrsString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        mrsString = `<div class="zero">${illustration}<p>No merge requests with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, mrsString);
    });
}

function getTodos(
  url = `${store.host}/api/v4/todos?per_page=${numberOfTodos}&access_token=${store.access_token}`,
) {
  let todosString = '';
  const type = "'Todos'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((todos) => {
      if (todos && todos.length > 0) {
        todosString = '<ul class="list-container">';
        todos.forEach((todo) => {
          const item = todo;
          todosString += '<li class="history-entry">';
          let location = '';
          if (item.project) {
            location = item.project.name_with_namespace;
          } else if (item.group) {
            location = item.group.name;
          }
          if (item.target_type === 'DesignManagement::Design') {
            item.target.title = item.body;
          }
          todosString += `<a href="${item.target_url}" target="_blank">${escapeHtml(
            item.target.title,
          )}</a><span class="namespace-with-time">Updated ${timeSince(
            new Date(item.updated_at),
          )} ago &middot; <a href="${item.target_url.split('/-/')[0]}" target="_blank">${escapeHtml(
            location,
          )}</a></span></div></li>`;
        });
        todosString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        todosString = `<div class="zero">${illustration}<p>Take the day off, you have no To-Dos!</p></div>`;
      }
      setElementHtml('#detail-content', todosString);
    });
}

function setupEmptyProjectPage() {
  let emptyPage =
    '<div id="project-pipeline"><div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div></div><div id="project-name"></div></div>';
  emptyPage += '<div class="headline"><span class="name">Issues</span></div>';
  emptyPage +=
    '<div id="project-recent-issues"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  emptyPage += '<div class="headline"><span class="name">Merge requests</span></div>';
  emptyPage +=
    '<div id="project-recent-mrs"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  setElementHtml('#detail-content', emptyPage);
}

function displayProjectPage(project) {
  let logo;
  if (project.avatar_url && project.avatar_url != null && project.visibility === 'public') {
    logo = `<img id="project-detail-avatar" src="${project.avatar_url}?width=64" />`;
  } else {
    logo = `<div id="project-detail-name-avatar">${project.name.charAt(0).toUpperCase()}</div>`;
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml(
    '#detail-header-content',
    `<div id="project-detail-information">
        ${logo}
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-namespace">
          ${escapeHtml(project.namespace.name)}
        </span>
      </div>
      <div class="detail-external-link">
        <a href="${escapeHtml(project.web_url)}" target="_blank">${externalLinkIcon}</a>
      </div>`,
  );
}

async function getProjectIssues(project) {
  let projectIssuesString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const issuesString = "'Issues'";

  const issues = await callApi(`projects/${project.id}/issues`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (issues && issues.length > 0) {
    projectIssuesString = '<ul class="list-container">';
    issues.forEach((issue) => {
      projectIssuesString += '<li class="history-entry">';
      projectIssuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
        issue.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(issue.created_at),
      )} ago &middot; ${escapeHtml(issue.author.name)}</span></div></li>`;
    });
    projectIssuesString += `<li class="more-link"><a onclick="goToSubDetail(${issuesString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectIssuesString += '</ul>';
  } else {
    projectIssuesString = '<p class="no-results with-all-link">No open issues.</p>';
    projectIssuesString += `<div class="all-link"><a onclick="goToSubDetail(${issuesString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-issues', projectIssuesString);
}

async function getProjectMRs(project) {
  let projectMRsString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const mrsString = "'Merge Requests'";

  const mrs = await callApi(`projects/${project.id}/merge_requests`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (mrs && mrs.length > 0) {
    projectMRsString += '<ul class="list-container">';
    mrs.forEach((mr) => {
      projectMRsString += '<li class="history-entry">';
      projectMRsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
        mr.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(mr.created_at),
      )} ago &middot; ${escapeHtml(mr.author.name)}</span></div></li>`;
    });
    projectMRsString += `<li class="more-link"><a onclick="goToSubDetail(${mrsString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectMRsString += '</ul>';
  } else {
    projectMRsString = '<p class="no-results with-all-link">No open merge requests.</p>';
    projectMRsString += `<div class="all-link"><a onclick="goToSubDetail(${mrsString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-mrs', projectMRsString);
}

function addBookmark(link) {
  if (store && store.bookmarks && store.bookmarks.length > 0) {
    const sameBookmarks = store.bookmarks.filter((item) => item.web_url === link);
    if (sameBookmarks.length > 0) {
      displayAddError('bookmark', '-', 'This bookmark has already been added.');
      return;
    }
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("bookmark-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").disabled = "disabled"');
  setElementHtml('#bookmark-add-button', `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then((bookmark) => {
        const allowedTypes = [
          'issues',
          'merge_requests',
          'epics',
          'projects',
          'groups',
          'boards',
          'users',
          'unknown',
        ];

        if (allowedTypes.includes(bookmark.type)) {
          const bookmarks = store.bookmarks || [];
          bookmarks.push(bookmark);
          store.bookmarks = bookmarks;
          getBookmarks();
        } else {
          displayAddError('bookmark', '-');
        }
      })
      .catch(() => {
        displayAddError('bookmark', '-');
      });
  } else {
    displayAddError('bookmark', '-');
  }
}

function addProject(link, target) {
  let newTarget = target;
  if (newTarget === 'project-settings-link') {
    newTarget = '-settings-';
  } else if (newTarget === 'project-overview-link') {
    newTarget = '-overview-';
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}add-button").disabled = "disabled"`,
  );
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}link").disabled = "disabled"`,
  );
  setElementHtml(`#project${newTarget}add-button`, `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then(async (object) => {
        if (
          !store['favorite-projects'] ||
          !store['favorite-projects'].filter((project) => project.web_url === object.web_url).length
        ) {
          if (object.type && object.type !== 'projects') {
            const projectWithNamespace = encodeURIComponent(
              link.split(`${store.host}/`)[1],
            ).replace(/%2F$/, '');
            const project = await callApi(`projects/${projectWithNamespace}`);
            const projects = store['favorite-projects'] || [];
            projects.push({
              id: project.id,
              visibility: project.visibility,
              web_url: project.web_url,
              name: project.name,
              title: project.name,
              namespace: {
                name: project.namespace.name,
              },
              parent_name: project.name_with_namespace,
              parent_url: project.namespace.web_url,
              name_with_namespace: project.name_with_namespace,
              open_issues_count: project.open_issues_count,
              last_activity_at: project.last_activity_at,
              avatar_url: project.avatar_url,
              star_count: project.star_count,
              forks_count: project.forks_count,
            });
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          } else {
            const projects = store['favorite-projects'] || [];
            projects.push(object);
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          }
        } else {
          displayAddError('project', newTarget, 'The same project was already added.');
        }
      })
      .catch(() => {
        displayAddError('project', newTarget);
      });
  } else {
    displayAddError('project', newTarget);
  }
}

function addShortcut(link) {
  const tempArray = [link];
  store.shortcuts = store.shortcuts.concat(tempArray);
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("shortcut-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").disabled = "disabled"');
  setElementHtml('#shortcut-add-button', `${spinner} Add`);
  setupCommandPalette();
  repaintShortcuts();
}

function startBookmarkDialog() {
  const bookmarkLink = "'bookmark-link'";
  const bookmarkInput = `<form action="#" id="bookmark-input" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter your link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-bookmark-dialog").classList.add("opened")');
  setElementHtml('#add-bookmark-dialog', bookmarkInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").focus()');
}

function startProjectDialog() {
  const projectLink = "'project-settings-link'";
  const projectInput = `<form action="#" class="project-input" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-settings-link" placeholder="Enter the link to the project here..." /><button class="add-button" id="project-settings-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-settings-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-project-dialog").classList.add("opened")');
  setElementHtml('#add-project-dialog', projectInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("project-settings-link").focus()');
}

function startShortcutDialog() {
  const shortcutLink = "'shortcut-link'";
  const shortcutInput = `<form action="#" class="shortcut-input" onsubmit="addShortcut(document.getElementById(${shortcutLink}).value);return false;"><input class="shortcut-link" id="shortcut-link" placeholder="Enter the keyboard shortcut here..." /><button class="add-button" id="shortcut-add-button" type="submit">Add</button></form><div class="add-shortcut-error" id="add-shortcut-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-shortcut-dialog").classList.add("opened")');
  setElementHtml('#add-shortcut-dialog', shortcutInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").focus()');
}

function displaySkeleton(count, pagination = false, id = 'detail-content') {
  let skeletonString = '<ul class="list-container empty';
  if (pagination) {
    skeletonString += ' with-pagination">';
  } else {
    skeletonString += '">';
  }
  for (let i = 0; i < count; i += 1) {
    skeletonString +=
      '<li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li>';
  }
  skeletonString += '</ul>';
  setElementHtml(`#${id}`, skeletonString);
}

function changeTheme(option = 'light', manual = false) {
  store.theme = option;
  if (option === 'light') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "light");');
  } else if (option === 'dark') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "dark");');
  }
  if (manual) {
    executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
    executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
    executeUnsafeJavaScript(`document.getElementById("${option}-mode").classList.add("active")`);
  }
}

mb.on('ready', () => {
  setupContextMenu();
  setupCommandPalette();

  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (store.analytics) {
      visitor.event('Visit external link', true).send();
    }
    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });
});

if (store.access_token && store.user_id && store.username) {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();

    mb.showWindow();
    changeTheme(store.theme, false);

    // Preloading content
    getUser();
    getLastTodo();
    getUsersPlan();
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();

    // Regularly relaoading content
    setInterval(() => {
      getLastEvent();
      getLastTodo();
    }, 10000);
  });

  mb.on('show', () => {
    if (store.analytics) {
      visitor.pageview('/').send();
    }
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();
  });
} else {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();
    mb.window.loadURL(`file://${__dirname}/login.html`).then(() => {
      changeTheme(store.theme, false);
      mb.showWindow();
    });
  });
}

ipcMain.on('detail-page', (event, arg) => {
  setElementHtml('#detail-headline', '');
  setElementHtml('#detail-content', '');
  if (arg.page === 'Project') {
    if (store.analytics) {
      visitor.pageview('/project').send();
    }
    setElementHtml(
      '#detail-headline',
      `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="commits-count" class="empty"></span><button onclick="changeCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`,
    );
    setupEmptyProjectPage();
    const project = JSON.parse(arg.object);
    currentProject = project;
    displayProjectPage(project);
    getProjectCommits(project);
    getProjectIssues(project);
    getProjectMRs(project);
  } else {
    executeUnsafeJavaScript(
      'document.getElementById("detail-header-content").classList.remove("empty")',
    );
    setElementHtml('#detail-header-content', arg.page);
    if (arg.page === 'Issues') {
      if (store.analytics) {
        visitor.pageview('/my-issues').send();
      }
      const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
      const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
          <div class="filter-sort">
            ${issuesQuerySelect}
            ${issuesStateSelect}
            ${issuesSortSelect}
          </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfIssues);
      getIssues();
    } else if (arg.page === 'Merge requests') {
      if (store.analytics) {
        visitor.pageview('/my-merge-requests').send();
      }
      let mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label>`;
      if (store.plan !== 'free') {
        mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label>`;
      }
      mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
      const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfMRs);
      getMRs();
    } else if (arg.page === 'To-Do list') {
      if (store.analytics) {
        visitor.pageview('/my-to-do-list').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      setElementHtml(
        '#detail-header-content',
        `${arg.page}<div class="detail-external-link">
        <a href="${escapeHtml(store.host)}/dashboard/todos" target="_blank">
          ${externalLinkIcon}
        </a>
        </div>`,
      );
      displaySkeleton(numberOfTodos);
      getTodos();
    } else if (arg.page === 'Recently viewed') {
      if (store.analytics) {
        visitor.pageview('/my-history').send();
      }
      displaySkeleton(numberOfRecentlyVisited);
      getMoreRecentlyVisited();
    } else if (arg.page === 'Comments') {
      if (store.analytics) {
        visitor.pageview('/my-comments').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      displaySkeleton(numberOfComments);
      getMoreRecentComments();
    }
  }
});

ipcMain.on('sub-detail-page', (event, arg) => {
  isOnSubPage = true;
  activeIssuesQueryOption = 'all';
  activeMRsQueryOption = 'all';
  let activeState = 'Open';
  let allChecked = '';
  let openChecked = ' checked';
  let allChanged = '';
  const project = JSON.parse(arg.project);
  setElementHtml('#sub-detail-headline', '');
  setElementHtml('#sub-detail-content', '');
  executeUnsafeJavaScript(
    'document.getElementById("sub-detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#sub-detail-header-content', arg.page);
  if (arg.page === 'Issues') {
    if (store.analytics) {
      visitor.pageview('/project/issues').send();
    }
    if (arg.all === true) {
      activeIssuesStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
    const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="issues-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}-issues" onchange="switchIssues(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-issues" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${issuesQuerySelect}
          ${issuesStateSelect}
          ${issuesSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfIssues, undefined, 'sub-detail-content');
    getIssues(
      `${store.host}/api/v4/projects/${project.id}/issues?scope=all&state=${activeIssuesStateOption}&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  } else if (arg.page === 'Merge Requests') {
    if (store.analytics) {
      visitor.pageview('/project/merge-requests').send();
    }
    if (arg.all === true) {
      activeMRsStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
    const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="mrs-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}-state" onchange="switchMRs(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-state" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})"><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})" checked><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfMRs, undefined, 'sub-detail-content');
    getMRs(
      `${store.host}/api/v4/projects/${project.id}/merge_requests?scope=all&state=${activeMRsStateOption}&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  }
});

ipcMain.on('back-to-detail-page', () => {
  isOnSubPage = false;
  activeIssuesQueryOption = 'assigned_to_me';
  activeMRsQueryOption = 'assigned_to_me';
});

ipcMain.on('go-to-overview', () => {
  if (store.analytics) {
    visitor.pageview('/').send();
  }
  getRecentlyVisited();
  getRecentComments();
  displayUsersProjects();
  getBookmarks();
  executeUnsafeJavaScript(
    'document.getElementById("detail-headline").classList.remove("with-overflow")',
  );
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.add("empty")',
  );
  setElementHtml('#detail-header-content', '');
  activeIssuesQueryOption = 'assigned_to_me';
  activeIssuesStateOption = 'opened';
  activeIssuesSortOption = 'created_at';
  activeMRsQueryOption = 'assigned_to_me';
  activeMRsStateOption = 'opened';
  activeMRsSortOption = 'created_at';
  moreRecentlyVisitedArray = [];
  recentProjectCommits = [];
  currentProjectCommit = null;
  currentProject = null;
});

ipcMain.on('go-to-settings', () => {
  openSettingsPage();
});

ipcMain.on('switch-issues', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch issues', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeIssuesQueryOption) {
    activeIssuesQueryOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-query-active', arg.text);
    if (
      (isOnSubPage === false && arg.label !== 'assigned_to_me') ||
      (isOnSubPage === true && arg.label !== 'all')
    ) {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'state' && arg.label !== activeIssuesStateOption) {
    activeIssuesStateOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeIssuesSortOption) {
    activeIssuesSortOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.remove("changed")',
      );
    }
  }
  url += `issues?scope=${activeIssuesQueryOption}&state=${activeIssuesStateOption}&order_by=${activeIssuesSortOption}&per_page=${numberOfIssues}&access_token=${store.access_token}`;
  getIssues(url, id);
});

ipcMain.on('switch-mrs', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch merge requests', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeMRsQueryOption) {
    activeMRsQueryOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-query-active', arg.text);
    if (arg.label !== 'all') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.remove("changed")',
      );
    }
  }
  if (arg.type === 'state' && arg.label !== activeMRsStateOption) {
    activeMRsStateOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeMRsSortOption) {
    activeMRsSortOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.remove("changed")',
      );
    }
  }
  url += 'merge_requests?scope=';
  if (activeMRsQueryOption === 'assigned_to_me' || activeMRsQueryOption === 'created_by_me') {
    url += activeMRsQueryOption;
  } else if (activeMRsQueryOption === 'approved_by_me') {
    url += `all&approved_by_ids[]=${store.user_id}`;
  } else if (activeMRsQueryOption === 'review_requests_for_me') {
    url += `all&reviewer_id=${store.user_id}`;
  } else if (activeMRsQueryOption === 'approval_rule_for_me') {
    url += `all&approver_ids[]=${store.user_id}`;
  }
  url += `&state=${activeMRsStateOption}&order_by=${activeMRsSortOption}&per_page=${numberOfMRs}&access_token=${store.access_token}`;
  getMRs(url, id);
});

ipcMain.on('switch-page', (event, arg) => {
  let id;
  if (isOnSubPage) {
    id = 'sub-detail-content';
  } else {
    id = 'detail-content';
  }
  if (arg.type === 'Todos') {
    displaySkeleton(numberOfTodos, true);
    getTodos(arg.url);
  } else if (arg.type === 'Issues') {
    displaySkeleton(numberOfIssues, true, id);
    getIssues(arg.url, id);
  } else if (arg.type === 'MRs') {
    displaySkeleton(numberOfMRs, true, id);
    getMRs(arg.url, id);
  } else if (arg.type === 'Comments') {
    displaySkeleton(numberOfComments, true);
    getMoreRecentComments(arg.url);
  }
});

ipcMain.on('search-recent', (event, arg) => {
  setElementHtml('#detail-content', '');
  searchRecentlyVisited(arg);
});

ipcMain.on('change-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate my commits', 'next').send();
    } else {
      visitor.event('Navigate my commits', 'previous').send();
    }
  }
  setElementHtml(
    '#pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentCommits, currentCommit);
  currentCommit = nextCommit;
  getCommitDetails(nextCommit.project_id, nextCommit.push_data.commit_to, nextCommit.index);
});

ipcMain.on('change-project-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate project commits', 'next').send();
    } else {
      visitor.event('Navigate project commits', 'previous').send();
    }
  }
  setElementHtml(
    '#project-pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentProjectCommits, currentProjectCommit);
  currentProjectCommit = nextCommit;
  getProjectCommitDetails(currentProject.id, nextCommit.id, nextCommit.index);
});

ipcMain.on('add-bookmark', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add bookmark').send();
  }
  addBookmark(arg);
});

ipcMain.on('add-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add project').send();
  }
  addProject(arg.input, arg.target);
});

ipcMain.on('add-shortcut', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add shortcut').send();
  }
  addShortcut(arg);
});

ipcMain.on('start-bookmark-dialog', () => {
  startBookmarkDialog();
});

ipcMain.on('start-project-dialog', () => {
  startProjectDialog();
});

ipcMain.on('start-shortcut-dialog', () => {
  startShortcutDialog();
});

ipcMain.on('delete-bookmark', (event, hashedUrl) => {
  if (store.analytics) {
    visitor.event('Delete bookmark').send();
  }
  if (store.bookmarks && store.bookmarks.length > 0) {
    const newBookmarks = store.bookmarks.filter(
      (bookmark) => sha256hex(bookmark.web_url) !== hashedUrl,
    );
    store.bookmarks = newBookmarks;
  }
  getBookmarks();
});

ipcMain.on('delete-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Delete project').send();
  }
  const projects = store['favorite-projects'];
  const newProjects = projects.filter((project) => project.id !== arg);
  store['favorite-projects'] = newProjects;
  // TODO Implement better way to refresh view after deleting project
  displayUsersProjects();
  openSettingsPage();
});

ipcMain.on('delete-shortcut', (event, arg) => {
  store.shortcuts = store.shortcuts.filter((keys) => keys !== arg);
  setupCommandPalette();
  repaintShortcuts();
});

ipcMain.on('change-theme', (event, arg) => {
  if (store.analytics) {
    visitor.event('Change theme', arg).send();
  }
  changeTheme(arg, true);
});

ipcMain.on('change-analytics', (event, arg) => {
  store.analytics = arg;
  if (store.analytics) {
    visitor = ua('UA-203420427-1', store.analytics_id);
  } else {
    visitor = null;
  }
});

ipcMain.on('change-keep-visible', (event, arg) => {
  store.keep_visible = arg;
  mb.window.setAlwaysOnTop(arg);
});

ipcMain.on('change-show-dock-icon', (event, arg) => {
  mb.window.setAlwaysOnTop(true);
  store.show_dock_icon = arg;
  if (arg) {
    app.dock.show().then(() => {
      mb.window.setAlwaysOnTop(store.keep_visible);
    });
  } else {
    app.dock.hide();
    app.focus({
      steal: true,
    });
    setTimeout(() => {
      app.focus({
        steal: true,
      });
      mb.window.setAlwaysOnTop(store.keep_visible);
    }, 200);
  }
});

ipcMain.on('choose-certificate', () => {
  chooseCertificate();
});

ipcMain.on('reset-certificate', () => {
  executeUnsafeJavaScript('document.getElementById("custom-cert-path-text").innerText=""');
  executeUnsafeJavaScript(
    'document.getElementById("custom-cert-path-text").classList.add("hidden")',
  );
  chooseCertificate();
});

ipcMain.on('start-login', () => {
  startLogin();
});

ipcMain.on('start-manual-login', (event, arg) => {
  if (arg.custom_cert_path) {
    saveUser(arg.access_token, arg.host, arg.custom_cert_path);
  } else {
    saveUser(arg.access_token, arg.host);
  }
});

ipcMain.on('logout', () => {
  if (store.analytics) {
    visitor.event('Log out', true).send();
  }
  logout();
});

/* eslint-env es2021 */
const { menubar } = require('menubar');
const { Menu, Notification, shell, ipcMain, dialog, app } = require('electron');
const { URL } = require('url');
const ua = require('universal-analytics');
const jsdom = require('jsdom');
const nodeCrypto = require('crypto');
const { escapeHtml, escapeQuotes, escapeSingleQuotes, sha256hex } = require('./lib/util');
const GitLab = require('./lib/gitlab');
const {
  chevronLgLeftIcon,
  chevronLgLeftIconWithViewboxHack,
  chevronLgRightIcon,
  chevronLgRightIconWithViewboxHack,
  chevronRightIcon,
  externalLinkIcon,
  projectIcon,
  removeIcon,
  todosAllDoneIllustration,
} = require('./src/icons');
const {
  allLabel,
  allText,
  approvalLabel,
  approvalText,
  approvedLabel,
  approvedText,
  assignedLabel,
  assignedText,
  closedLabel,
  closedText,
  createdLabel,
  createdText,
  dueDateLabel,
  dueDateText,
  mergedLabel,
  mergedText,
  openedLabel,
  openedText,
  query,
  recentlyCreatedLabel,
  recentlyCreatedText,
  recentlyUpdatedLabel,
  recentlyUpdatedText,
  reviewedLabel,
  reviewedText,
  sort,
  state,
} = require('./src/filter-text');
const { store, deleteFromStore } = require('./lib/store');
const BrowserHistory = require('./lib/browser-history');
const processInfo = require('./lib/process-info');
const { version } = require('./package.json');
const CommandPalette = require('./src/command-palette');
// eslint-disable-next-line no-shadow
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { JSDOM } = jsdom;
let commandPalette;
global.DOMParser = new JSDOM().window.DOMParser;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let visitor;
if (store.analytics) {
  visitor = ua('UA-203420427-1', store.analytics_id);
}
let recentlyVisitedString = '';
let currentProject;
let moreRecentlyVisitedArray = [];
let recentCommits = [];
let currentCommit;
let lastEventId;
let lastTodoId = -1;
let recentProjectCommits = [];
let currentProjectCommit;
const numberOfRecentlyVisited = 3;
const numberOfFavoriteProjects = 5;
const numberOfRecentComments = 3;
const numberOfIssues = 10;
const numberOfMRs = 10;
const numberOfTodos = 10;
const numberOfComments = 5;
let activeIssuesQueryOption = 'assigned_to_me';
let activeIssuesStateOption = 'opened';
let activeIssuesSortOption = 'created_at';
let activeMRsQueryOption = 'assigned_to_me';
let activeMRsStateOption = 'opened';
let activeMRsSortOption = 'created_at';
let runningPipelineSubscriptions = [];
let runningPipelineSubscriptionInterval = -1;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let isOnSubPage = false;

// Anti rebound variables
const delay = 2000;
let lastUserExecution = 0;
let lastRecentlyVisitedExecution = 0;
let lastLastCommitsExecution = 0;
let lastRecentCommentsExecution = 0;

let lastUserExecutionFinished = true;
let lastRecentlyVisitedExecutionFinished = true;
let lastLastCommitsExecutionFinished = true;
let lastRecentCommentsExecutionFinished = true;

let refreshInProgress = false;

let verifier = '';
let challenge = '';

const mb = menubar({
  showDockIcon: store.show_dock_icon,
  showOnAllWorkspaces: false,
  icon: `${__dirname}/assets/gitlabTemplate.png`,
  preloadWindow: true,
  browserWindow: {
    width: 550,
    height: 700,
    minWidth: 265,
    minHeight: 300,
    webPreferences: {
      preload: `${__dirname}/preload.js`,
      nodeIntegration: process.env.NODE_ENV === 'test',
      contextIsolation: process.env.NODE_ENV !== 'test',
      enableRemoteModule: process.env.NODE_ENV === 'test',
    },
    alwaysOnTop: store.keep_visible,
  },
});

const executeUnsafeJavaScript = (js) => mb.window.webContents.executeJavaScript(js);

const setElementHtml = (selector, html) =>
  // This is caused by a Pretter/eslint mismatch
  // eslint-disable-next-line implicit-arrow-linebreak
  executeUnsafeJavaScript(
    `document.querySelector("${escapeQuotes(selector)}").innerHTML = "${escapeQuotes(html).replace(
      /\n/g,
      '\\n',
    )}"`,
  );

// eslint-disable-next-line object-curly-newline
async function callApi(what, options = {}, host = store.host) {
  return new Promise((resolve, reject) => {
    GitLab.get(what, options, host)
      .then((result) => {
        if (result && result.error) {
          // eslint-disable-next-line no-use-before-define
          tryRefresh();
        }
        resolve(result);
      })
      .catch(() => {
        reject();
      });
  });
}

function openSettingsPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/settings').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'Settings');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  const lightString = "'light'";
  const darkString = "'dark'";
  setElementHtml('#detail-headline', '<span class="name">Theme</span>');
  let settingsString = '';
  const theme = `<div id="theme-selection"><div id="light-mode" class="theme-option" onclick="changeTheme(${lightString})"><div class="indicator"></div>Light</div><div id="dark-mode" class="theme-option" onclick="changeTheme(${darkString})"><div class="indicator"></div>Dark</div></div>`;
  if (store.user_id && store.username) {
    const projects = store['favorite-projects'];
    let favoriteProjects =
      '<div class="headline"><span class="name">Favorite projects</span></div><div id="favorite-projects"><ul class="list-container">';
    if (projects && projects.length > 0) {
      projects.forEach((project) => {
        favoriteProjects += `<li>${projectIcon}<div class="name-with-namespace"><span>${escapeHtml(
          project.name,
        )}</span><span class="namespace">${escapeHtml(project.namespace.name)}</span></div>`;
        favoriteProjects += `<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteProject(${project.id})">${removeIcon}</div></div></li>`;
      });
    }
    favoriteProjects += `<li id="add-project-dialog" class="more-link"><a onclick="startProjectDialog()">Add another project ${chevronRightIcon}</a></li></ul></div>`;
    let preferences =
      '<div class="headline"><span class="name">Preferences</span></div><div id="preferences"><form id="prerefences-form">';
    preferences += '<div><input type="checkbox" id="keep-visible" name="keep-visible" ';
    if (store.keep_visible) {
      preferences += ' checked="checked"';
    }
    preferences +=
      'onchange="changeKeepVisible(this.checked)"/><label for="keep-visible">Keep GitDock visible, even when losing focus.</label></div>';
    if (processInfo.platform === 'darwin') {
      preferences += '<div><input type="checkbox" id="show-dock-icon" name="show-dock-icon" ';
      if (store.show_dock_icon) {
        preferences += ' checked="checked"';
      }
      preferences +=
        'onchange="changeShowDockIcon(this.checked)"/><label for="show-dock-icon">Show icon also in dock, not only in menubar.</label></div>';
    }
    preferences += '</form></div>';
    let shortcut =
      '<div class="headline"><span class="name">Command Palette shortcuts</span></div><div id="shortcut"><p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p>';
    if (store.shortcuts) {
      shortcut += '<ul class="list-container">';
      store.shortcuts.forEach((keys) => {
        shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
      });
      shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
    }
    shortcut += '</div>';
    let analyticsString =
      '<div class="headline"><span class="name">Analytics</span></div><div id="analytics">';
    analyticsString +=
      'To better understand how you make use of GitDock features to navigate around your issues, MRs, and other areas, we would love to collect insights about your usage. All data is 100% anonymous and we do not track the specific content (projects, issues...) you are interacting with, only which kind of areas you are using.</div>';
    analyticsString += `<form id="analytics-form"><div><input type="radio" id="analytics-yes" name="analytics" value="yes"${
      store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(true)"><label for="analytics-yes">Yes, collect anonymous data.</label></div><div><input type="radio" id="analytics-no" name="analytics" value="no"${
      !store.analytics ? ' checked' : ''
    } onclick="changeAnalytics(false)"><label for="analytics-no">No, do not collect any data.</label></div></form>`;
    const signout =
      '<div class="headline"><span class="name">User</span></div><div id="user-administration"><button id="logout-button" onclick="logout()">Log out</button></div>';
    settingsString = theme + favoriteProjects + preferences + shortcut + analyticsString + signout;
  } else {
    settingsString = theme;
  }
  setElementHtml('#detail-content', `${settingsString}</div>`);
  executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
  executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
  executeUnsafeJavaScript(`document.getElementById("${store.theme}-mode").classList.add("active")`);
}

function openAboutPage() {
  // eslint-disable-next-line no-underscore-dangle
  if (!mb._isVisible) {
    mb.showWindow();
  }
  if (store.analytics) {
    visitor.pageview('/about').send();
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#detail-header-content', 'About GitDock ⚓️');
  setElementHtml('#detail-content', '');
  executeUnsafeJavaScript('document.getElementById("detail-view").style.left = 0');
  executeUnsafeJavaScript('document.body.style.overflow = "hidden"');
  setElementHtml('#detail-headline', '<span class="name">About GitDock ⚓️</span>');
  let aboutString =
    '<p>GitDock is a MacOS/Windows/Linux app that displays all your GitLab activities in one place. Instead of the GitLab typical project- or group-centric approach, it collects all your information from a user-centric perspective.</p>';
  aboutString +=
    '<p>If you want to learn more about why we built this app, you can have a look at our <a href="https://about.gitlab.com/blog/2021/10/05/gitpod-desktop-app-personal-activities" target="_blank">blog post</a>.</p>';
  aboutString +=
    '<p>We use issues to collect bugs, feature requests, and more. You can <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues" target="_blank">browse through existing issues</a>. To report a bug, suggest an improvement, or propose a feature, please <a href="https://gitlab.com/mvanremmerden/gitdock/-/issues/new">create a new issue</a> if there is not already an issue for it.</p>';
  aboutString +=
    '<p>If you are thinking about contributing directly, check out our <a href="https://gitlab.com/mvanremmerden/gitdock/-/blob/main/CONTRIBUTING.md" target="_blank">contribution guidelines</a>.</p>';
  aboutString += `<p class="version-number">Version ${version}</p>`;
  setElementHtml('#detail-content', `${aboutString}</div>`);
}

function setupLinuxContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GitDock',
      click: () => mb.showWindow(),
      visible: processInfo.platform === 'linux',
    },
    ...baseMenuItems,
  ]);

  mb.tray.setContextMenu(menu);
}

function setupGenericContextMenu(baseMenuItems) {
  const menu = Menu.buildFromTemplate(baseMenuItems);

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(menu);
  });
}

function setupContextMenu() {
  const baseMenuItems = [
    {
      label: 'Settings',
      click: () => {
        openSettingsPage();
      },
    },
    {
      label: 'About',
      click: () => {
        openAboutPage();
      },
    },
    {
      label: 'Quit',
      click: () => {
        mb.app.quit();
      },
    },
  ];

  if (processInfo.platform === 'linux') {
    setupLinuxContextMenu(baseMenuItems);
  } else {
    setupGenericContextMenu(baseMenuItems);
  }
}

function setupCommandPalette() {
  if (!commandPalette) {
    commandPalette = new CommandPalette();
  }

  commandPalette.register({
    shortcut: store.shortcuts,
  });
}

function chooseCertificate() {
  mb.window.setAlwaysOnTop(true);
  const filepaths = dialog.showOpenDialogSync();
  setTimeout(() => {
    mb.window.setAlwaysOnTop(false);
  }, 200);
  if (filepaths) {
    const filepath = filepaths[0].replace(/\\/g, '/'); // convert \ to / otherwise separators get lost on windows
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-button").classList.add("hidden")',
    );
    executeUnsafeJavaScript(
      `document.getElementById("custom-cert-path-text").innerText="${filepath}"`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-text").classList.remove("hidden")',
    );
    executeUnsafeJavaScript(
      'document.getElementById("custom-cert-path-reset").classList.remove("hidden")',
    );
  }
}

function repaintShortcuts() {
  let shortcut =
    '<p>To learn more about which keyboard shortcuts you can configure, visit the <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank">Electron Accelerator page</a>.</p><ul class="list-container">';
  if (store.shortcuts) {
    store.shortcuts.forEach((keys) => {
      shortcut += `<li>${keys}<div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteShortcut('${keys}')">${removeIcon}</div></li>`;
    });
    shortcut += `<li id="add-shortcut-dialog" class="more-link"><a onclick="startShortcutDialog()">Add another shortcut ${chevronRightIcon}</a></li></ul>`;
  }
  shortcut += '</div>';
  setElementHtml('#shortcut', shortcut);
}

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function timeSince(date, direction = 'since') {
  let seconds;
  if (direction === 'since') {
    seconds = Math.floor((new Date() - date) / 1000);
  } else if (direction === 'to') {
    seconds = Math.floor((date - new Date()) / 1000);
  }
  let interval = seconds / 31536000;
  if (interval >= 2) {
    return `${Math.floor(interval)} years`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} year`;
  }
  interval = seconds / 2592000;
  if (interval > 2) {
    return `${Math.floor(interval)} months`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} month`;
  }
  interval = seconds / 604800;
  if (interval > 2) {
    return `${Math.floor(interval)} weeks`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} week`;
  }
  interval = seconds / 86400;
  if (interval > 2) {
    return `${Math.floor(interval)} days`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} day`;
  }
  interval = seconds / 3600;
  if (interval >= 2) {
    return `${Math.floor(interval)} hours`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} hour`;
  }
  interval = seconds / 60;
  if (interval > 2) {
    return `${Math.floor(interval)} minutes`;
  }
  if (interval > 1 && interval < 2) {
    return `${Math.floor(interval)} minute`;
  }
  return `${Math.floor(seconds)} seconds`;
}

function logout() {
  deleteFromStore('user_id');
  deleteFromStore('username');
  deleteFromStore('access_token');
  deleteFromStore('custom_cert_path');
  deleteFromStore('host');
  deleteFromStore('plan');
  mb.window.webContents.session.clearCache();
  mb.window.webContents.session.clearStorageData();
  app.quit();
  app.relaunch();
}

function displayUsersProjects() {
  let favoriteProjectsHtml = '';
  const projects = store['favorite-projects'];
  if (projects && projects.length > 0) {
    favoriteProjectsHtml += '<ul class="list-container clickable" data-testid="favorite-projects">';
    const chevron = chevronLgRightIcon;
    projects.forEach((projectObject) => {
      const projectString = "'Project'";
      const jsonProjectObject = JSON.parse(JSON.stringify(projectObject));
      jsonProjectObject.name_with_namespace = projectObject.name_with_namespace;
      jsonProjectObject.namespace.name = projectObject.namespace.name;
      jsonProjectObject.name = projectObject.name;
      const projectJson = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
      favoriteProjectsHtml += `<li onclick="goToDetail(${projectString}, ${projectJson})">${projectIcon}`;
      favoriteProjectsHtml += `<div class="name-with-namespace"><span>${escapeHtml(
        projectObject.name,
      )}</span><span class="namespace">${escapeHtml(
        projectObject.namespace.name,
      )}</span></div><div class="chevron-right-wrapper">${chevron}</div></li>`;
    });
    favoriteProjectsHtml += '</ul>';
  } else {
    const projectLink = "'project-overview-link'";
    favoriteProjectsHtml = `<div class="new-project"><div><span class="cta">Track projects you care about</span> 🌟</div><div class="cta-description">Add any project you want a directly accessible shortcut for.</div><form class="project-input" action="#" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-overview-link" placeholder="Enter the project link here..." /><button class="add-button" id="project-overview-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-overview-error"></div></div>`;
  }
  setElementHtml('#projects', favoriteProjectsHtml);
}

async function getUsersProjects() {
  const projects = await callApi(`users/${store.user_id}/starred_projects`, {
    min_access_level: 30,
    per_page: numberOfFavoriteProjects,
    order_by: 'updated_at',
  });
  if (projects) {
    return projects.map((project) => ({
      id: project.id,
      visibility: project.visibility,
      web_url: project.web_url,
      name: project.name,
      namespace: {
        name: project.namespace.name,
      },
      added: Date.now(),
      name_with_namespace: project.name_with_namespace,
      open_issues_count: project.open_issues_count,
      last_activity_at: project.last_activity_at,
      avatar_url: project.avatar_url,
      star_count: project.star_count,
      forks_count: project.forks_count,
    }));
  }
  return false;
}

function getBookmarks() {
  const { bookmarks } = store;
  let bookmarksString = '';
  if (bookmarks && bookmarks.length > 0) {
    bookmarksString = '<ul class="list-container">';
    bookmarks.forEach((bookmark) => {
      let namespaceLink = '';
      if (bookmark.parent_name && bookmark.parent_url) {
        namespaceLink = ` &middot; <a href="${bookmark.parent_url}" target="_blank">${escapeHtml(
          bookmark.parent_name,
        )}</a>`;
      }

      let { title } = bookmark;

      if (bookmark.id && ['merge_requests', 'issues'].includes(bookmark.type)) {
        const typeIndicator = GitLab.indicatorForType(bookmark.type);
        title += ` (${typeIndicator}${bookmark.id})`;
      }

      bookmarksString += `<li class="history-entry bookmark-entry"><div class="bookmark-information"><a href="${escapeSingleQuotes(
        escapeHtml(bookmark.web_url),
      )}" id="bookmark-title" target="_blank">${escapeHtml(
        title,
      )}</a><span class="namespace-with-time">Added ${timeSince(
        bookmark.added,
      )} ago${namespaceLink}</span></div><div class="bookmark-delete-wrapper"><div class="bookmark-delete" onclick="deleteBookmark('${sha256hex(
        bookmark.web_url,
      )}')">${removeIcon}</div></div></li>`;
    });
    bookmarksString += `<li id="add-bookmark-dialog" class="more-link"><a onclick="startBookmarkDialog()">Add another bookmark ${chevronRightIcon}</a></li></ul>`;
  } else {
    const bookmarkLink = "'bookmark-link'";
    bookmarksString = `<div id="new-bookmark"><div><span class="cta">Add a new GitLab bookmark</span> 🔖</div><div class="cta-description">Bookmarks are helpful when you have an issue/merge request you will have to come back to repeatedly.</div><form id="bookmark-input" action="#" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter the link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div></div>`;
  }
  setElementHtml('#bookmarks', bookmarksString);
}

async function getRecentlyVisited() {
  if (lastRecentlyVisitedExecutionFinished && lastRecentlyVisitedExecution + delay < Date.now()) {
    lastRecentlyVisitedExecutionFinished = false;
    const recentlyVisitedArray = [];
    recentlyVisitedString = '';
    let firstItem = true;
    await BrowserHistory.getAllHistory().then(async (history) => {
      const item = Array.prototype.concat.apply([], history);
      item.sort((a, b) => {
        if (a.utc_time > b.utc_time) {
          return -1;
        }
        if (b.utc_time > a.utc_time) {
          return 1;
        }
        return -1;
      });
      let i = 0;
      for (let j = 0; j < item.length; j += 1) {
        if (
          item[j].title &&
          item[j].url.indexOf(`${store.host}/`) === 0 &&
          (item[j].url.indexOf('/-/issues/') !== -1 ||
            item[j].url.indexOf('/-/merge_requests/') !== -1 ||
            item[j].url.indexOf('/-/epics/') !== -1) &&
          !recentlyVisitedArray.includes(item[j].title) &&
          item[j].title.split('·')[0] !== 'Not Found' &&
          item[j].title.split('·')[0] !== 'New Issue ' &&
          item[j].title.split('·')[0] !== 'New Merge Request ' &&
          item[j].title.split('·')[0] !== 'New merge request ' &&
          item[j].title.split('·')[0] !== 'New Epic ' &&
          item[j].title.split('·')[0] !== 'Edit ' &&
          item[j].title.split('·')[0] !== 'Merge requests ' &&
          item[j].title.split('·')[0] !== 'Issues '
        ) {
          if (firstItem) {
            recentlyVisitedString = '<ul class="list-container">';
            firstItem = false;
          }
          const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
          if (nameWithNamespace.split('/')[0] !== 'groups') {
            item.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
              nameWithNamespace.split('/')[1]
            }?access_token=${store.access_token}`;
          } else {
            item.url = `${store.host}/api/v4/groups/${
              nameWithNamespace.split('/')[0]
            }?access_token=${store.access_token}`;
          }
          recentlyVisitedArray.push(item[j].title);
          if (item[j].title !== 'Checking your Browser - GitLab') {
            recentlyVisitedString += '<li class="history-entry">';
            recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
              item[j].title.split('·')[0],
            )}</a><span class="namespace-with-time">${timeSince(
              new Date(`${item[j].utc_time} UTC`),
            )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
              item[j].title.split('·')[2].trim(),
            )}</a></span></div></li>`;
            i += 1;
            if (i === numberOfRecentlyVisited) {
              break;
            }
          }
        }
      }
      if (!firstItem) {
        const moreString = "'Recently viewed'";
        recentlyVisitedString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
      } else if (BrowserHistory.isSupported()) {
        recentlyVisitedString = `<p class="no-results">Recently visited objects will show up here.<br/><span class="supported-browsers">Supported browsers: ${BrowserHistory.supportedBrowserNames()}.</span></p>`;
      } else {
        recentlyVisitedString =
          '<p class="no-results"><span class="supported-browsers">No browsers are supported on your operating system yet.</span></p>';
      }
      setElementHtml('#history', recentlyVisitedString);
      lastRecentlyVisitedExecution = Date.now();
      lastRecentlyVisitedExecutionFinished = true;
    });
  }
}

async function subscribeToRunningPipeline() {
  if (runningPipelineSubscriptionInterval !== -1) {
    clearInterval(runningPipelineSubscriptionInterval);
  }
  runningPipelineSubscriptionInterval = setInterval(async () => {
    runningPipelineSubscriptions.forEach(async (runningPipeline) => {
      const pipeline = await callApi(
        `projects/${runningPipeline.project_id}/pipelines/${runningPipeline.id}`,
      );
      if (pipeline) {
        let pipelineStatus;
        if (pipeline.status !== 'running') {
          if (pipeline.status === 'success') {
            pipelineStatus = 'succeeded';
          } else {
            pipelineStatus = pipeline.status;
          }
          const updateNotification = new Notification({
            title: `Pipeline ${pipelineStatus}`,
            subtitle: GitLab.fetchUrlInfo(pipeline.web_url).namespaceWithProject,
            body: runningPipeline.commit_title,
          });
          updateNotification.on('click', () => {
            shell.openExternal(pipeline.web_url);
          });
          updateNotification.show();
          runningPipelineSubscriptions = runningPipelineSubscriptions.filter(
            (subscriptionPipeline) => subscriptionPipeline.id !== pipeline.id,
          );
          if (runningPipelineSubscriptions.length === 0) {
            clearInterval(runningPipelineSubscriptionInterval);
            runningPipelineSubscriptionInterval = -1;
            mb.tray.setImage(`${__dirname}/assets/gitlabTemplate.png`);
          }
        }
      }
    });
  }, 10000);
}

async function getLastPipelines(commits) {
  const projectArray = [];
  if (commits && commits.length > 0) {
    commits.forEach(async (commit) => {
      if (!projectArray.includes(commit.project_id)) {
        projectArray.push(commit.project_id);
        const pipelines = await callApi(`projects/${commit.project_id}/pipelines`, {
          status: 'running',
          username: store.username,
          per_page: 1,
          page: 1,
        });
        if (pipelines && pipelines.length > 0) {
          mb.tray.setImage(`${__dirname}/assets/runningTemplate.png`);
          pipelines.forEach(async (pipeline) => {
            const commitPipeline = pipeline;
            if (
              runningPipelineSubscriptions.findIndex(
                (subscriptionPipeline) => subscriptionPipeline.id === pipeline.id,
              ) === -1
            ) {
              const pipelineCommit = await callApi(
                `projects/${pipeline.project_id}/repository/commits/${pipeline.sha}`,
              );
              if (pipelineCommit) {
                commitPipeline.commit_title = pipelineCommit.title;
                runningPipelineSubscriptions.push(commitPipeline);
                const runningNotification = new Notification({
                  title: 'Pipeline running',
                  subtitle: GitLab.fetchUrlInfo(commitPipeline.web_url).namespaceWithProject,
                  body: commitPipeline.commit_title,
                });
                runningNotification.on('click', () => {
                  shell.openExternal(commitPipeline.web_url);
                });
                runningNotification.show();
              }
            }
          });
          subscribeToRunningPipeline();
        }
      }
    });
  }
}

function displayAddError(type, target, customMessage) {
  executeUnsafeJavaScript(
    `document.getElementById("add-${type}${target}error").style.display = "block"`,
  );
  if (customMessage) {
    setElementHtml(`#add-${type}${target}error`, customMessage);
  } else {
    setElementHtml(`#add-${type}${target}error`, `This is not a valid GitLab ${type} URL.`);
  }
  executeUnsafeJavaScript(`document.getElementById("${type}${target}add-button").disabled = false`);
  executeUnsafeJavaScript(`document.getElementById("${type}${target}link").disabled = false`);
  setElementHtml(`#${type}${target}add-button`, 'Add');
}

function displayPagination(keysetLinks, type) {
  let paginationString = '';
  if (keysetLinks.indexOf('rel="next"') !== -1 || keysetLinks.indexOf('rel="prev"') !== -1) {
    paginationString += '<div id="pagination">';
    if (keysetLinks.indexOf('rel="prev"') !== -1) {
      let prevLink = '';
      prevLink = escapeHtml(`"${keysetLinks.split('>; rel="prev"')[0].substring(1)}"`);
      paginationString += `<button onclick="switchPage(${prevLink}, ${type})" class="prev">${chevronLgLeftIcon} Previous</button>`;
    } else {
      paginationString += '<div></div>';
    }
    if (keysetLinks.indexOf('rel="next"') !== -1) {
      let nextLink = '';
      if (keysetLinks.indexOf('rel="prev"') !== -1) {
        nextLink = escapeHtml(
          `"${keysetLinks.split('rel="prev", ')[1].split('>; rel="next"')[0].substring(1)}"`,
        );
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      } else {
        nextLink = escapeHtml(`"${keysetLinks.split('>; rel="next"')[0].substring(1)}"`);
        paginationString += `<button onclick="switchPage(${nextLink}, ${type})" class="next">Next ${chevronLgRightIcon}</button>`;
      }
    } else {
      paginationString += '<div></div>';
    }
    paginationString += '</div>';
  }
  return paginationString;
}

function renderCollabject(comment, collabject) {
  const collabObject = collabject;
  if (collabObject.message && collabObject.message === '404 Not found') {
    return 0;
  }
  if (comment.note.noteable_type === 'DesignManagement::Design') {
    collabObject.web_url += `/designs/${comment.target_title}`;
    return `<li class="comment"><a href="${collabObject.web_url}#note_${
      comment.note.id
    }" target="_blank">${escapeHtml(
      comment.note.body,
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(comment.created_at),
    )} ago &middot; <a href="${
      collabObject.web_url.split('#note')[0]
    }" target="_blank">${escapeHtml(comment.target_title)}</a></span></div></li>`;
  }
  return `<li class="comment"><a href="${collabObject.web_url}#note_${
    comment.note.id
  }" target="_blank">${escapeHtml(
    comment.note.body,
  )}</a><span class="namespace-with-time">${timeSince(
    new Date(comment.created_at),
  )} ago &middot; <a href="${collabObject.web_url.split('#note')[0]}" target="_blank">${escapeHtml(
    comment.target_title,
  )}</a></span></div></li>`;
}

function displayCommit(commit, project, focus = 'project') {
  let logo = '';
  if (commit.last_pipeline) {
    logo += `<a target="_blank" href="${commit.last_pipeline.web_url}" class="pipeline-link">`;
    if (commit.last_pipeline.status === 'scheduled') {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7"/><circle class="icon" style="fill: var(--svg-status-bg, #c9d1d9);" cx="7" cy="7" r="6"/><g transform="translate(2.75 2.75)" fill-rule="nonzero"><path d="M4.165 7.81a3.644 3.644 0 1 1 0-7.29 3.644 3.644 0 0 1 0 7.29zm0-1.042a2.603 2.603 0 1 0 0-5.206 2.603 2.603 0 0 0 0 5.206z"/><rect x="3.644" y="2.083" width="1.041" height="2.603" rx=".488"/><rect x="3.644" y="3.644" width="2.083" height="1.041" rx=".488"/></g></svg>';
    } else {
      logo +=
        '<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="M0 7a7 7 0 1 1 14 0A7 7 0 0 1 0 7z" class="icon"/><path d="M13 7A6 6 0 1 0 1 7a6 6 0 0 0 12 0z" class="icon-inverse" />';
      if (commit.last_pipeline.status === 'running') {
        logo +=
          '<path d="M7 3c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.3 0-2.5-.7-3.3-1.7L7 7V3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'failed') {
        logo +=
          '<path d="M7 5.969L5.599 4.568a.29.29 0 0 0-.413.004l-.614.614a.294.294 0 0 0-.004.413L5.968 7l-1.4 1.401a.29.29 0 0 0 .004.413l.614.614c.113.114.3.117.413.004L7 8.032l1.401 1.4a.29.29 0 0 0 .413-.004l.614-.614a.294.294 0 0 0 .004-.413L8.032 7l1.4-1.401a.29.29 0 0 0-.004-.413l-.614-.614a.294.294 0 0 0-.413-.004L7 5.968z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'success') {
        logo +=
          '<path d="M6.278 7.697L5.045 6.464a.296.296 0 0 0-.42-.002l-.613.614a.298.298 0 0 0 .002.42l1.91 1.909a.5.5 0 0 0 .703.005l.265-.265L9.997 6.04a.291.291 0 0 0-.009-.408l-.614-.614a.29.29 0 0 0-.408-.009L6.278 7.697z" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'pending') {
        logo +=
          '<path d="M4.7 5.3c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H5c-.2 0-.3-.1-.3-.3V5.3m3 0c0-.2.1-.3.3-.3h.9c.2 0 .3.1.3.3v3.4c0 .2-.1.3-.3.3H8c-.2 0-.3-.1-.3-.3V5.3" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'canceled') {
        logo +=
          '<path d="M5.2 3.8l4.9 4.9c.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0L3.8 5.2c-.2-.2-.2-.5 0-.7l.7-.7c.2-.2.5-.2.7 0" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'skipped') {
        logo +=
          '<path d="M6.415 7.04L4.579 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L5.341 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L6.415 7.04zm2.54 0L7.119 5.203a.295.295 0 0 1 .004-.416l.349-.349a.29.29 0 0 1 .416-.004l2.214 2.214a.289.289 0 0 1 .019.021l.132.133c.11.11.108.291 0 .398L7.881 9.573a.282.282 0 0 1-.398 0l-.331-.331a.285.285 0 0 1 0-.399L8.955 7.04z" class="icon"/></svg>';
      } else if (commit.last_pipeline.status === 'created') {
        logo += '<circle cx="7" cy="7" r="3.25" class="icon"/></g></svg>';
      } else if (commit.last_pipeline.status === 'preparing') {
        logo +=
          '</g><circle cx="7" cy="7" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="4" cy="7" r="1"/></g></svg>';
      } else if (commit.last_pipeline.status === 'manual') {
        logo +=
          '<path d="M10.5 7.63V6.37l-.787-.13c-.044-.175-.132-.349-.263-.61l.481-.652-.918-.913-.657.478a2.346 2.346 0 0 0-.612-.26L7.656 3.5H6.388l-.132.783c-.219.043-.394.13-.612.26l-.657-.478-.918.913.437.652c-.131.218-.175.392-.262.61l-.744.086v1.261l.787.13c.044.218.132.392.263.61l-.438.651.92.913.655-.434c.175.086.394.173.613.26l.131.783h1.313l.131-.783c.219-.043.394-.13.613-.26l.656.478.918-.913-.48-.652c.13-.218.218-.435.262-.61l.656-.13zM7 8.283a1.285 1.285 0 0 1-1.313-1.305c0-.739.57-1.304 1.313-1.304.744 0 1.313.565 1.313 1.304 0 .74-.57 1.305-1.313 1.305z" class="icon"/></g></svg>';
      }
    }
  }
  logo += '</a>';
  let subline;
  if (focus === 'project') {
    subline = `<a href="${project.web_url}" target=_blank">${escapeHtml(
      project.name_with_namespace,
    )}</a>`;
  } else {
    subline = escapeHtml(commit.author_name);
  }
  return `<div class="commit"><div class="commit-information"><a href="${
    commit.web_url
  }" target="_blank">${escapeHtml(commit.title)}</a><span class="namespace-with-time">${timeSince(
    new Date(commit.committed_date),
  )} ago &middot; ${subline}</span></div>${logo}</div>`;
}

function renderNoCommitsPushedYetMessage() {
  executeUnsafeJavaScript('document.getElementById("commits-pagination").classList.add("hidden")');
  setElementHtml('#pipeline', '<p class="no-results">You haven&#039;t pushed any commits yet.</p>');
}

async function getCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("commits-pagination").classList.remove("hidden")',
  );
  executeUnsafeJavaScript('document.getElementById("commits-count").classList.remove("empty")');
  setElementHtml('#commits-count', `${index}/${recentCommits.length}`);
  const project = await callApi(`projects/${projectId}`);
  const commit = await callApi(`projects/${project.id}/repository/commits/${sha}`);
  if (project && commit) {
    setElementHtml('#pipeline', displayCommit(commit, project));
  }
}

async function getLastCommits(count = 20) {
  if (lastLastCommitsExecutionFinished && lastLastCommitsExecution + delay < Date.now()) {
    lastLastCommitsExecutionFinished = false;

    const commits = await callApi('events', {
      action: 'pushed',
      per_page: count,
    });
    if (commits && Array.isArray(commits) && !commits.error) {
      if (commits && commits.length > 0) {
        lastEventId = commits[0].id;
        getLastPipelines(commits);
        const committedArray = commits.filter(
          /* eslint-disable implicit-arrow-linebreak */
          (commit) =>
            commit.action_name === 'pushed to' ||
            (commit.action_name === 'pushed new' &&
              commit.push_data.commit_to &&
              commit.push_data.commit_count > 0),
          /* eslint-enable */
        );
        if (committedArray && committedArray.length > 0) {
          [currentCommit] = committedArray;
          recentCommits = committedArray;
          getCommitDetails(committedArray[0].project_id, committedArray[0].push_data.commit_to, 1);
        } else {
          renderNoCommitsPushedYetMessage();
        }
      } else {
        renderNoCommitsPushedYetMessage();
      }
    }
    lastLastCommitsExecution = Date.now();
    lastLastCommitsExecutionFinished = true;
  }
}

async function getRecentComments() {
  if (lastRecentCommentsExecutionFinished && lastRecentCommentsExecution + delay < Date.now()) {
    lastRecentCommentsExecutionFinished = false;
    let recentCommentsString = '';

    const comments = await callApi('events', {
      action: 'commented',
      per_page: numberOfRecentComments,
    });
    if (comments && Array.isArray(comments) && !comments.error) {
      if (comments && comments.length > 0) {
        recentCommentsString += '<ul class="list-container">';
        /* eslint-disable no-restricted-syntax, no-continue, no-await-in-loop */
        for (const comment of comments) {
          const path = GitLab.commentToNoteableUrl(comment);

          if (!path) {
            continue;
          }

          const collabject = await callApi(path);
          if (collabject) {
            recentCommentsString += renderCollabject(comment, collabject);
          }
        }
        // eslint-disable no-restricted-syntax */
        const moreString = "'Comments'";
        recentCommentsString += `<li class="more-link"><a onclick="goToDetail(${moreString})">View more ${chevronRightIcon}</a></li></ul>`;
        setElementHtml('#comments', recentCommentsString);
      } else {
        setElementHtml(
          '#comments',
          '<p class="no-results">You haven&#039;t written any comments yet.</p>',
        );
      }
    }
    lastRecentCommentsExecution = Date.now();
    lastRecentCommentsExecutionFinished = true;
  }
}

async function getLastEvent() {
  if (!recentCommits || recentCommits.length === 0) {
    return;
  }
  const lastEvent = await callApi('events', {
    action: 'pushed',
    per_page: 1,
  });
  if (lastEvent && lastEvent.id !== lastEventId) {
    lastEventId = lastEvent.id;
    getLastCommits();
    getRecentComments();
  }
}

async function getLastTodo() {
  const todo = await callApi('todos', {
    per_page: 1,
  });
  if (todo && lastTodoId !== todo.id) {
    if (lastTodoId !== -1 && Date.parse(todo.created_at) > Date.now() - 20000) {
      const todoNotification = new Notification({
        title: todo.body,
        subtitle: todo.author.name,
        body: todo.target.title,
      });
      todoNotification.on('click', () => {
        shell.openExternal(todo.target_url);
      });
      todoNotification.show();
    }
    lastTodoId = todo.id;
  }
}

async function getUser() {
  if (lastUserExecutionFinished && lastUserExecution + delay < Date.now()) {
    lastUserExecutionFinished = false;

    const user = await callApi('user');
    if (user && !user.error) {
      let avatarUrl;
      if (user.avatar_url) {
        avatarUrl = new URL(user.avatar_url);
        if (avatarUrl.host !== 'secure.gravatar.com') {
          avatarUrl.href += '?width=64';
        }
      }
      const userHtml = `<a href="${user.web_url}" target="_blank"><img src="${
        avatarUrl.href
      }" /><div class="user-information"><span class="user-name">${escapeHtml(
        user.name,
      )}</span><span class="username">@${escapeHtml(user.username)}</span></div></a>`;
      setElementHtml('#user', userHtml);
      lastUserExecution = Date.now();
      lastUserExecutionFinished = true;
    }
  }
}

function tryRefresh() {
  if (!refreshInProgress) {
    refreshInProgress = true;
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        refresh_token: store.refresh_token,
        grant_type: 'refresh_token',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        if (result.access_token && result.refresh_token) {
          store.access_token = result.access_token;
          store.refresh_token = result.refresh_token;
          lastUserExecution = 0;
          lastLastCommitsExecution = 0;
          lastRecentCommentsExecution = 0;

          lastUserExecutionFinished = true;
          lastLastCommitsExecutionFinished = true;
          lastRecentCommentsExecutionFinished = true;

          getUser();
          getLastTodo();
          getLastCommits();
          getRecentComments();
        } else {
          logout();
        }
        refreshInProgress = false;
      })
      .catch(() => {
        refreshInProgress = false;
        logout();
      });
  }
}

async function saveUser(
  accessToken,
  url = store.host,
  customCertPath = undefined,
  refreshToken = undefined,
) {
  try {
    if (url.endsWith('/')) {
      /* eslint-disable no-param-reassign */
      url = url.substring(0, url.length - 1);
    }
    /* eslint-disable operator-linebreak, object-curly-newline */
    const options = customCertPath
      ? { access_token: accessToken, custom_cert_path: customCertPath }
      : { access_token: accessToken };
    /* eslint-enable */
    const result = await callApi('user', options, url);
    if (result && result.id && result.username) {
      store.access_token = accessToken;
      store.user_id = result.id;
      store.username = result.username;
      store.host = url;
      if (refreshToken) {
        store.refresh_token = refreshToken;
      }
      if (customCertPath) {
        store.custom_cert_path = customCertPath;
      }
      getUsersProjects().then(async (projects) => {
        if (
          store['favorite-projects'] &&
          store['favorite-projects'].length === 0 &&
          projects &&
          projects.length > 0
        ) {
          store['favorite-projects'] = projects;
        }
        // eslint-disable-next-line no-use-before-define
        mb.window.removeListener('page-title-updated', handleLogin);
        await mb.window
          .loadURL(`file://${__dirname}/index.html`)
          .then(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          })
          .catch(() => {
            getUser();
            displayUsersProjects();
            getBookmarks();
            getRecentlyVisited();
            getLastCommits();
            getRecentComments();
          });
      });
    }
  } catch (e) {
    throw new Error(e);
  }
}

function handleLogin() {
  if (mb.window.webContents.getURL().indexOf('?code=') !== -1) {
    const code = mb.window.webContents.getURL().split('?code=')[1].replace('&state=test', '');
    fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee',
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://mvanremmerden.gitlab.io/gitdock-login/',
        code_verifier: verifier,
      }),
    })
      .then((result) => result.json())
      .then((result) => {
        saveUser(result.access_token, 'https://gitlab.com', undefined, result.refresh_token);
      });
  }
}

async function startLogin() {
  verifier = base64URLEncode(nodeCrypto.randomBytes(32));
  challenge = base64URLEncode(sha256(verifier));
  await mb.window.loadURL(
    `${store.host}/oauth/authorize?client_id=2ab9d5c2290a3efcacbd5fc99ef469b7767ef5656cfc09376944b03ef4a8acee&redirect_uri=https://mvanremmerden.gitlab.io/gitdock-login/&response_type=code&state=test&scope=read_api&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  mb.window.on('page-title-updated', handleLogin);
  mb.showWindow();
}

async function getUsersPlan() {
  let userNamespace;
  const namespaces = await callApi('namespaces');
  if (namespaces && namespaces.length > 0) {
    userNamespace = namespaces.find((namespace) => namespace.kind === 'user');
  }

  store.plan = userNamespace && userNamespace.plan ? userNamespace.plan : 'free';
}

async function getProjectCommits(project, count = 20) {
  const commits = await callApi(`projects/${project.id}/repository/commits`, {
    per_page: count,
  });
  if (commits && commits.length > 0) {
    recentProjectCommits = commits;
    [currentProjectCommit] = commits;

    const commit = await callApi(`projects/${project.id}/repository/commits/${commits[0].id}`, {
      per_page: count,
    });
    if (commit) {
      const pagination = `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="project-commits-count">1/${recentProjectCommits.length}</span><button onclick="changeProjectCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeProjectCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`;
      setElementHtml('#detail-headline', pagination);
      setElementHtml('#project-pipeline', displayCommit(commit, project, 'author'));
    }
  } else {
    setElementHtml('#project-commits-pagination', '<span class="name">Commits</span>');
    setElementHtml('#project-pipeline', '<p class="no-results">No commits pushed yet.</p>');
  }
}

function changeCommit(forward, commitArray, chosenCommit) {
  let nextCommit;
  let index = commitArray.findIndex((commit) => commit.id === chosenCommit.id);
  if (forward) {
    if (index === commitArray.length - 1) {
      [nextCommit] = commitArray;
      index = 1;
    } else {
      nextCommit = commitArray[index + 1];
      index += 2;
    }
  } else if (index === 0) {
    nextCommit = commitArray[commitArray.length - 1];
    index = commitArray.length;
  } else {
    nextCommit = commitArray[index - 1];
  }
  nextCommit.index = index;
  return nextCommit;
}

async function getProjectCommitDetails(projectId, sha, index) {
  executeUnsafeJavaScript(
    'document.getElementById("project-commits-count").classList.remove("empty")',
  );
  setElementHtml('#project-commits-count', `${index}/${recentProjectCommits.length}`);

  const commit = await callApi(`projects/${projectId}/repository/commits/${sha}`);
  if (commit) {
    setElementHtml('#project-pipeline', displayCommit(commit, currentProject, 'author'));
  }
}

async function getMoreRecentlyVisited() {
  recentlyVisitedString = '';
  let firstItem = true;
  await BrowserHistory.getAllHistory().then(async (history) => {
    const item = Array.prototype.concat.apply([], history);
    item.sort((a, b) => {
      if (a.utc_time > b.utc_time) {
        return -1;
      }
      if (b.utc_time > a.utc_time) {
        return 1;
      }
      return -1;
    });
    setElementHtml(
      '#detail-headline',
      '<input id="recentSearch" type="text" onkeyup="searchRecent(this)" placeholder="Search..." />',
    );

    let previousDate = 0;
    for (let j = 0; j < item.length; j += 1) {
      const { title } = item[j];
      let { url } = item[j];
      const isHostUrl = url.startsWith(`${store.host}/`);
      const isIssuable =
        url.includes('/-/issues/') ||
        url.includes('/-/merge_requests/') ||
        url.includes('/-/epics/');
      const wasNotProcessed = !moreRecentlyVisitedArray.some((object) => object.title === title);
      const ignoredTitlePrefixes = [
        'Not Found',
        'New Issue',
        'New Merge Request',
        'New merge request',
        'New Epic',
        'Edit',
        'Merge Conflicts',
        'Merge requests',
        'Issues',
        '500 Error - GitLab',
        'Checking your Browser - GitLab',
      ];
      const titlePrefix = (title || '').split('·')[0].trim();
      if (
        title &&
        isHostUrl &&
        isIssuable &&
        wasNotProcessed &&
        !ignoredTitlePrefixes.includes(titlePrefix)
      ) {
        const nameWithNamespace = item[j].url.replace(`${store.host}/`, '').split('/-/')[0];
        if (nameWithNamespace.split('/')[0] !== 'groups') {
          url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
            nameWithNamespace.split('/')[1]
          }?access_token=${store.access_token}`;
        } else {
          url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
            store.access_token
          }`;
        }
        const currentDate = new Date(item[j].utc_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: timezone,
        });
        if (previousDate !== currentDate) {
          if (
            currentDate ===
            new Date(Date.now()).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              timeZone: timezone,
            })
          ) {
            recentlyVisitedString += '<div class="date">Today</div>';
          } else {
            if (!firstItem) {
              recentlyVisitedString += '</ul>';
            }
            recentlyVisitedString += `<div class="date">${currentDate}</div>`;
          }
          recentlyVisitedString += '<ul class="list-container history-list-container">';
          previousDate = currentDate;
        }
        moreRecentlyVisitedArray.push(item[j]);
        recentlyVisitedString += '<li class="history-entry">';
        recentlyVisitedString += `<a href="${item[j].url}" target="_blank">${escapeHtml(
          item[j].title.split('·')[0],
        )}</a><span class="namespace-with-time">${timeSince(
          new Date(`${item[j].utc_time} UTC`),
        )} ago &middot; <a href="${item[j].url.split('/-/')[0]}" target="_blank">${escapeHtml(
          item[j].title.split('·')[2].trim(),
        )}</a></span></div></li>`;
        firstItem = false;
      }
    }
    recentlyVisitedString += '</ul>';
    setElementHtml('#detail-content', recentlyVisitedString);
  });
}

function searchRecentlyVisited(searchterm) {
  /* eslint-disable implicit-arrow-linebreak, function-paren-newline */
  const foundArray = moreRecentlyVisitedArray.filter((item) =>
    item.title.toLowerCase().includes(searchterm),
  );
  /* eslint-enable */
  let foundString = '<ul class="list-container">';
  foundArray.forEach((item) => {
    const object = item;
    const nameWithNamespace = object.url.replace(`${store.host}/`, '').split('/-/')[0];
    if (nameWithNamespace.split('/')[0] !== 'groups') {
      object.url = `${store.host}/api/v4/projects/${nameWithNamespace.split('/')[0]}%2F${
        nameWithNamespace.split('/')[1]
      }?access_token=${store.access_token}`;
    } else {
      object.url = `${store.host}/api/v4/groups/${nameWithNamespace.split('/')[0]}?access_token=${
        store.access_token
      }`;
    }
    foundString += '<li class="history-entry">';
    foundString += `<a href="${object.url}" target="_blank">${escapeHtml(
      object.title.split('·')[0],
    )}</a><span class="namespace-with-time">${timeSince(
      new Date(`${object.utc_time} UTC`),
    )} ago &middot; <a href="${object.url.split('/-/')[0]}" target="_blank">${escapeHtml(
      object.title.split('·')[2].trim(),
    )}</a></span></div></li>`;
  });
  foundString += '</ul>';
  setElementHtml('#detail-content', foundString);
}

function getMoreRecentComments(
  url = `${store.host}/api/v4/events?action=commented&per_page=${numberOfComments}&access_token=${store.access_token}`,
) {
  let recentCommentsString = '<ul class="list-container">';
  const type = "'Comments'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then(async (comments) => {
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const comment of comments) {
        const path = GitLab.commentToNoteableUrl(comment);
        const collabject = await callApi(path);
        if (collabject) {
          recentCommentsString += renderCollabject(comment, collabject);
        }
      }
      /* eslint-enable */
      recentCommentsString += `</ul>${displayPagination(keysetLinks, type)}`;
      setElementHtml('#detail-content', recentCommentsString);
    });
}

function getIssues(
  url = `${store.host}/api/v4/issues?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let issuesString = '';
  const type = "'Issues'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((issues) => {
      if (issues && issues.length > 0) {
        issuesString += '<ul class="list-container">';
        issues.forEach((issue) => {
          let timestamp;
          if (activeIssuesSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(issue.updated_at))} ago`;
          } else if (activeIssuesSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(issue.created_at))} ago`;
          } else if (activeIssuesSortOption === 'due_date&sort=asc') {
            if (!issue.due_date) {
              timestamp = 'No due date';
            } else if (new Date() > new Date(issue.due_date)) {
              timestamp = `Due ${timeSince(new Date(issue.due_date))} ago`;
            } else {
              timestamp = `Due in ${timeSince(new Date(issue.due_date), 'to')}`;
            }
          }
          issuesString += '<li class="history-entry">';
          issuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
            issue.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            issue.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(
            issue.references.full.split('#')[0],
          )}</a></span></div></li>`;
        });
        issuesString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        issuesString = `<div class="zero">${illustration}<p>No issues with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, issuesString);
    });
}

function getMRs(
  url = `${store.host}/api/v4/merge_requests?scope=assigned_to_me&state=opened&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
  id = 'detail-content',
) {
  let mrsString = '';
  const type = "'MRs'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((mrs) => {
      if (mrs && mrs.length > 0) {
        mrsString = '<ul class="list-container">';
        mrs.forEach((mr) => {
          let timestamp;
          if (activeMRsSortOption === 'updated_at') {
            timestamp = `Updated ${timeSince(new Date(mr.updated_at))} ago`;
          } else if (activeMRsSortOption === 'created_at') {
            timestamp = `Created ${timeSince(new Date(mr.created_at))} ago`;
          }
          mrsString += '<li class="history-entry">';
          mrsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
            mr.title,
          )}</a><span class="namespace-with-time">${timestamp} &middot; <a href="${
            mr.web_url.split('/-/')[0]
          }" target="_blank">${escapeHtml(mr.references.full.split('!')[0])}</a></span></div></li>`;
        });
        mrsString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        mrsString = `<div class="zero">${illustration}<p>No merge requests with the specified criteria.</p></div>`;
      }
      setElementHtml(`#${id}`, mrsString);
    });
}

function getTodos(
  url = `${store.host}/api/v4/todos?per_page=${numberOfTodos}&access_token=${store.access_token}`,
) {
  let todosString = '';
  const type = "'Todos'";
  let keysetLinks;
  fetch(url)
    .then((result) => {
      keysetLinks = result.headers.get('Link');
      return result.json();
    })
    .then((todos) => {
      if (todos && todos.length > 0) {
        todosString = '<ul class="list-container">';
        todos.forEach((todo) => {
          const item = todo;
          todosString += '<li class="history-entry">';
          let location = '';
          if (item.project) {
            location = item.project.name_with_namespace;
          } else if (item.group) {
            location = item.group.name;
          }
          if (item.target_type === 'DesignManagement::Design') {
            item.target.title = item.body;
          }
          todosString += `<a href="${item.target_url}" target="_blank">${escapeHtml(
            item.target.title,
          )}</a><span class="namespace-with-time">Updated ${timeSince(
            new Date(item.updated_at),
          )} ago &middot; <a href="${item.target_url.split('/-/')[0]}" target="_blank">${escapeHtml(
            location,
          )}</a></span></div></li>`;
        });
        todosString += `</ul>${displayPagination(keysetLinks, type)}`;
      } else {
        const illustration = todosAllDoneIllustration;
        todosString = `<div class="zero">${illustration}<p>Take the day off, you have no To-Dos!</p></div>`;
      }
      setElementHtml('#detail-content', todosString);
    });
}

function setupEmptyProjectPage() {
  let emptyPage =
    '<div id="project-pipeline"><div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div></div><div id="project-name"></div></div>';
  emptyPage += '<div class="headline"><span class="name">Issues</span></div>';
  emptyPage +=
    '<div id="project-recent-issues"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  emptyPage += '<div class="headline"><span class="name">Merge requests</span></div>';
  emptyPage +=
    '<div id="project-recent-mrs"><div id="history"><ul class="list-container empty"><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li><li class="more-link empty"><div class="more-link-button skeleton"></div></li></ul></div></div>';
  setElementHtml('#detail-content', emptyPage);
}

function displayProjectPage(project) {
  let logo;
  if (project.avatar_url && project.avatar_url != null && project.visibility === 'public') {
    logo = `<img id="project-detail-avatar" src="${project.avatar_url}?width=64" />`;
  } else {
    logo = `<div id="project-detail-name-avatar">${project.name.charAt(0).toUpperCase()}</div>`;
  }
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.remove("empty")',
  );
  setElementHtml(
    '#detail-header-content',
    `<div id="project-detail-information">
        ${logo}
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-namespace">
          ${escapeHtml(project.namespace.name)}
        </span>
      </div>
      <div class="detail-external-link">
        <a href="${escapeHtml(project.web_url)}" target="_blank">${externalLinkIcon}</a>
      </div>`,
  );
}

async function getProjectIssues(project) {
  let projectIssuesString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const issuesString = "'Issues'";

  const issues = await callApi(`projects/${project.id}/issues`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (issues && issues.length > 0) {
    projectIssuesString = '<ul class="list-container">';
    issues.forEach((issue) => {
      projectIssuesString += '<li class="history-entry">';
      projectIssuesString += `<a href="${issue.web_url}" target="_blank">${escapeHtml(
        issue.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(issue.created_at),
      )} ago &middot; ${escapeHtml(issue.author.name)}</span></div></li>`;
    });
    projectIssuesString += `<li class="more-link"><a onclick="goToSubDetail(${issuesString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectIssuesString += '</ul>';
  } else {
    projectIssuesString = '<p class="no-results with-all-link">No open issues.</p>';
    projectIssuesString += `<div class="all-link"><a onclick="goToSubDetail(${issuesString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-issues', projectIssuesString);
}

async function getProjectMRs(project) {
  let projectMRsString = '';
  const jsonProjectObject = JSON.parse(JSON.stringify(project));
  jsonProjectObject.name_with_namespace = project.name_with_namespace;
  jsonProjectObject.namespace.name = project.namespace.name;
  jsonProjectObject.name = project.name;
  const projectString = `'${escapeHtml(JSON.stringify(jsonProjectObject))}'`;
  const mrsString = "'Merge Requests'";

  const mrs = await callApi(`projects/${project.id}/merge_requests`, {
    state: 'opened',
    order_by: 'created_at',
    per_page: 3,
  });
  if (mrs && mrs.length > 0) {
    projectMRsString += '<ul class="list-container">';
    mrs.forEach((mr) => {
      projectMRsString += '<li class="history-entry">';
      projectMRsString += `<a href="${mr.web_url}" target="_blank">${escapeHtml(
        mr.title,
      )}</a><span class="namespace-with-time">Created ${timeSince(
        new Date(mr.created_at),
      )} ago &middot; ${escapeHtml(mr.author.name)}</span></div></li>`;
    });
    projectMRsString += `<li class="more-link"><a onclick="goToSubDetail(${mrsString}, ${projectString})">View more ${chevronRightIcon}</a></li>`;
    projectMRsString += '</ul>';
  } else {
    projectMRsString = '<p class="no-results with-all-link">No open merge requests.</p>';
    projectMRsString += `<div class="all-link"><a onclick="goToSubDetail(${mrsString}, ${projectString}, true)">View all ${chevronRightIcon}</a></div>`;
  }
  setElementHtml('#project-recent-mrs', projectMRsString);
}

function addBookmark(link) {
  if (store && store.bookmarks && store.bookmarks.length > 0) {
    const sameBookmarks = store.bookmarks.filter((item) => item.web_url === link);
    if (sameBookmarks.length > 0) {
      displayAddError('bookmark', '-', 'This bookmark has already been added.');
      return;
    }
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("bookmark-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").disabled = "disabled"');
  setElementHtml('#bookmark-add-button', `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then((bookmark) => {
        const allowedTypes = [
          'issues',
          'merge_requests',
          'epics',
          'projects',
          'groups',
          'boards',
          'users',
          'unknown',
        ];

        if (allowedTypes.includes(bookmark.type)) {
          const bookmarks = store.bookmarks || [];
          bookmarks.push(bookmark);
          store.bookmarks = bookmarks;
          getBookmarks();
        } else {
          displayAddError('bookmark', '-');
        }
      })
      .catch(() => {
        displayAddError('bookmark', '-');
      });
  } else {
    displayAddError('bookmark', '-');
  }
}

function addProject(link, target) {
  let newTarget = target;
  if (newTarget === 'project-settings-link') {
    newTarget = '-settings-';
  } else if (newTarget === 'project-overview-link') {
    newTarget = '-overview-';
  }
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}add-button").disabled = "disabled"`,
  );
  executeUnsafeJavaScript(
    `document.getElementById("project${newTarget}link").disabled = "disabled"`,
  );
  setElementHtml(`#project${newTarget}add-button`, `${spinner} Add`);
  if (GitLab.urlHasValidHost(link)) {
    GitLab.parseUrl(link)
      .then(async (object) => {
        if (
          !store['favorite-projects'] ||
          !store['favorite-projects'].filter((project) => project.web_url === object.web_url).length
        ) {
          if (object.type && object.type !== 'projects') {
            const projectWithNamespace = encodeURIComponent(
              link.split(`${store.host}/`)[1],
            ).replace(/%2F$/, '');
            const project = await callApi(`projects/${projectWithNamespace}`);
            const projects = store['favorite-projects'] || [];
            projects.push({
              id: project.id,
              visibility: project.visibility,
              web_url: project.web_url,
              name: project.name,
              title: project.name,
              namespace: {
                name: project.namespace.name,
              },
              parent_name: project.name_with_namespace,
              parent_url: project.namespace.web_url,
              name_with_namespace: project.name_with_namespace,
              open_issues_count: project.open_issues_count,
              last_activity_at: project.last_activity_at,
              avatar_url: project.avatar_url,
              star_count: project.star_count,
              forks_count: project.forks_count,
            });
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          } else {
            const projects = store['favorite-projects'] || [];
            projects.push(object);
            store['favorite-projects'] = projects;
            if (newTarget === '-settings-') {
              openSettingsPage();
            }
            displayUsersProjects(projects);
          }
        } else {
          displayAddError('project', newTarget, 'The same project was already added.');
        }
      })
      .catch(() => {
        displayAddError('project', newTarget);
      });
  } else {
    displayAddError('project', newTarget);
  }
}

function addShortcut(link) {
  const tempArray = [link];
  store.shortcuts = store.shortcuts.concat(tempArray);
  const spinner =
    '<svg class="button-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><g fill="none" fill-rule="evenodd"><circle cx="7" cy="7" r="6" stroke="#c9d1d9" stroke-opacity=".4" stroke-width="2"/><path class="icon" fill-opacity=".4" fill-rule="nonzero" d="M7 0a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V0z"/></g></svg>';
  executeUnsafeJavaScript('document.getElementById("shortcut-add-button").disabled = "disabled"');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").disabled = "disabled"');
  setElementHtml('#shortcut-add-button', `${spinner} Add`);
  setupCommandPalette();
  repaintShortcuts();
}

function startBookmarkDialog() {
  const bookmarkLink = "'bookmark-link'";
  const bookmarkInput = `<form action="#" id="bookmark-input" onsubmit="addBookmark(document.getElementById(${bookmarkLink}).value);return false;"><input id="bookmark-link" placeholder="Enter your link here..." /><button class="add-button" id="bookmark-add-button" type="submit">Add</button></form><div id="add-bookmark-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-bookmark-dialog").classList.add("opened")');
  setElementHtml('#add-bookmark-dialog', bookmarkInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("bookmark-link").focus()');
}

function startProjectDialog() {
  const projectLink = "'project-settings-link'";
  const projectInput = `<form action="#" class="project-input" onsubmit="addProject(document.getElementById(${projectLink}).value, ${projectLink});return false;"><input class="project-link" id="project-settings-link" placeholder="Enter the link to the project here..." /><button class="add-button" id="project-settings-add-button" type="submit">Add</button></form><div class="add-project-error" id="add-project-settings-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-project-dialog").classList.add("opened")');
  setElementHtml('#add-project-dialog', projectInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("project-settings-link").focus()');
}

function startShortcutDialog() {
  const shortcutLink = "'shortcut-link'";
  const shortcutInput = `<form action="#" class="shortcut-input" onsubmit="addShortcut(document.getElementById(${shortcutLink}).value);return false;"><input class="shortcut-link" id="shortcut-link" placeholder="Enter the keyboard shortcut here..." /><button class="add-button" id="shortcut-add-button" type="submit">Add</button></form><div class="add-shortcut-error" id="add-shortcut-error"></div>`;
  executeUnsafeJavaScript('document.getElementById("add-shortcut-dialog").classList.add("opened")');
  setElementHtml('#add-shortcut-dialog', shortcutInput);
  executeUnsafeJavaScript('window.scrollBy(0, 14)');
  executeUnsafeJavaScript('document.getElementById("shortcut-link").focus()');
}

function displaySkeleton(count, pagination = false, id = 'detail-content') {
  let skeletonString = '<ul class="list-container empty';
  if (pagination) {
    skeletonString += ' with-pagination">';
  } else {
    skeletonString += '">';
  }
  for (let i = 0; i < count; i += 1) {
    skeletonString +=
      '<li class="history-entry empty"><div class="history-link skeleton"></div><div class="history-details skeleton"></div></li>';
  }
  skeletonString += '</ul>';
  setElementHtml(`#${id}`, skeletonString);
}

function changeTheme(option = 'light', manual = false) {
  store.theme = option;
  if (option === 'light') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "light");');
  } else if (option === 'dark') {
    executeUnsafeJavaScript('document.documentElement.setAttribute("data-theme", "dark");');
  }
  if (manual) {
    executeUnsafeJavaScript('document.getElementById("light-mode").classList.remove("active")');
    executeUnsafeJavaScript('document.getElementById("dark-mode").classList.remove("active")');
    executeUnsafeJavaScript(`document.getElementById("${option}-mode").classList.add("active")`);
  }
}

mb.on('ready', () => {
  setupContextMenu();
  setupCommandPalette();

  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (store.analytics) {
      visitor.event('Visit external link', true).send();
    }
    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });
});

if (store.access_token && store.user_id && store.username) {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();

    mb.showWindow();
    changeTheme(store.theme, false);

    // Preloading content
    getUser();
    getLastTodo();
    getUsersPlan();
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();

    // Regularly relaoading content
    setInterval(() => {
      getLastEvent();
      getLastTodo();
    }, 10000);
  });

  mb.on('show', () => {
    if (store.analytics) {
      visitor.pageview('/').send();
    }
    getRecentlyVisited();
    getLastCommits();
    getRecentComments();
    displayUsersProjects();
    getBookmarks();
  });
} else {
  mb.on('after-create-window', () => {
    // mb.window.webContents.openDevTools();
    mb.window.loadURL(`file://${__dirname}/login.html`).then(() => {
      changeTheme(store.theme, false);
      mb.showWindow();
    });
  });
}

ipcMain.on('detail-page', (event, arg) => {
  setElementHtml('#detail-headline', '');
  setElementHtml('#detail-content', '');
  if (arg.page === 'Project') {
    if (store.analytics) {
      visitor.pageview('/project').send();
    }
    setElementHtml(
      '#detail-headline',
      `<div id="project-commits-pagination"><span class="name">Commits</span><div id="commits-pagination"><span id="commits-count" class="empty"></span><button onclick="changeCommit(false)">${chevronLgLeftIconWithViewboxHack}</button><button onclick="changeCommit(true)">${chevronLgRightIconWithViewboxHack}</button></div></div>`,
    );
    setupEmptyProjectPage();
    const project = JSON.parse(arg.object);
    currentProject = project;
    displayProjectPage(project);
    getProjectCommits(project);
    getProjectIssues(project);
    getProjectMRs(project);
  } else {
    executeUnsafeJavaScript(
      'document.getElementById("detail-header-content").classList.remove("empty")',
    );
    setElementHtml('#detail-header-content', arg.page);
    if (arg.page === 'Issues') {
      if (store.analytics) {
        visitor.pageview('/my-issues').send();
      }
      const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
      const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
          <div class="filter-sort">
            ${issuesQuerySelect}
            ${issuesStateSelect}
            ${issuesSortSelect}
          </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfIssues);
      getIssues();
    } else if (arg.page === 'Merge requests') {
      if (store.analytics) {
        visitor.pageview('/my-merge-requests').send();
      }
      let mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">Assigned</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})" checked><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label>`;
      if (store.plan !== 'free') {
        mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label>`;
      }
      mrsQuerySelect += `<input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
      const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-state-active">Open</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${state}, ${allText})"><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})" checked><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
      const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
      setElementHtml(
        '#detail-headline',
        `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
      );
      executeUnsafeJavaScript(
        'document.getElementById("detail-headline").classList.add("with-overflow")',
      );
      displaySkeleton(numberOfMRs);
      getMRs();
    } else if (arg.page === 'To-Do list') {
      if (store.analytics) {
        visitor.pageview('/my-to-do-list').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      setElementHtml(
        '#detail-header-content',
        `${arg.page}<div class="detail-external-link">
        <a href="${escapeHtml(store.host)}/dashboard/todos" target="_blank">
          ${externalLinkIcon}
        </a>
        </div>`,
      );
      displaySkeleton(numberOfTodos);
      getTodos();
    } else if (arg.page === 'Recently viewed') {
      if (store.analytics) {
        visitor.pageview('/my-history').send();
      }
      displaySkeleton(numberOfRecentlyVisited);
      getMoreRecentlyVisited();
    } else if (arg.page === 'Comments') {
      if (store.analytics) {
        visitor.pageview('/my-comments').send();
      }
      setElementHtml('#detail-headline', `<span class="name">${arg.page}</span>`);
      displaySkeleton(numberOfComments);
      getMoreRecentComments();
    }
  }
});

ipcMain.on('sub-detail-page', (event, arg) => {
  isOnSubPage = true;
  activeIssuesQueryOption = 'all';
  activeMRsQueryOption = 'all';
  let activeState = 'Open';
  let allChecked = '';
  let openChecked = ' checked';
  let allChanged = '';
  const project = JSON.parse(arg.project);
  setElementHtml('#sub-detail-headline', '');
  setElementHtml('#sub-detail-content', '');
  executeUnsafeJavaScript(
    'document.getElementById("sub-detail-header-content").classList.remove("empty")',
  );
  setElementHtml('#sub-detail-header-content', arg.page);
  if (arg.page === 'Issues') {
    if (store.analytics) {
      visitor.pageview('/project/issues').send();
    }
    if (arg.all === true) {
      activeIssuesStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const issuesQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-query-select" type="radio" id="${allLabel}" onchange="switchIssues(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="issues-query-select" type="radio" id="${assignedLabel}" onchange="switchIssues(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="issues-query-select" type="radio" id="${createdLabel}" onchange="switchIssues(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label></div></div>`;
    const issuesStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="issues-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-state-select" type="radio" id="${allLabel}-issues" onchange="switchIssues(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-issues" class="custom-option-label">All</label><input class="custom-option" name="issues-state-select" type="radio" id="${openedLabel}" onchange="switchIssues(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="issues-state-select" type="radio" id="${closedLabel}" onchange="switchIssues(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const issuesSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="issues-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchIssues(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})" checked><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="issues-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchIssues(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})"><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label><input class="custom-option" name="issues-sort-select" type="radio" id="${dueDateLabel}" onchange="switchIssues(${dueDateLabel}, ${sort}, ${dueDateText})"><label for="${dueDateLabel}" class="custom-option-label">Sort by due date</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${issuesQuerySelect}
          ${issuesStateSelect}
          ${issuesSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfIssues, undefined, 'sub-detail-content');
    getIssues(
      `${store.host}/api/v4/projects/${project.id}/issues?scope=all&state=${activeIssuesStateOption}&order_by=created_at&per_page=${numberOfIssues}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  } else if (arg.page === 'Merge Requests') {
    if (store.analytics) {
      visitor.pageview('/project/merge-requests').send();
    }
    if (arg.all === true) {
      activeMRsStateOption = 'all';
      activeState = 'All';
      allChecked = ' checked';
      openChecked = '';
      allChanged = ' changed';
    }
    const mrsQuerySelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-query-active">All</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-query-select" type="radio" id="${allLabel}" onchange="switchMRs(${allLabel}, ${query}, ${allText})" checked><label for="${allLabel}" class="custom-option-label">All</label><input class="custom-option" name="mrs-query-select" type="radio" id="${assignedLabel}" onchange="switchMRs(${assignedLabel}, ${query}, ${assignedText})"><label for="${assignedLabel}" class="custom-option-label">Assigned</label><input class="custom-option" name="mrs-query-select" type="radio" id="${createdLabel}" onchange="switchMRs(${createdLabel}, ${query}, ${createdText})"><label for="${createdLabel}" class="custom-option-label">Created</label><input class="custom-option" name="mrs-query-select" type="radio" id="${reviewedLabel}" onchange="switchMRs(${reviewedLabel}, ${query}, ${reviewedText})"><label for="${reviewedLabel}" class="custom-option-label">Review requests</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvedLabel}" onchange="switchMRs(${approvedLabel}, ${query}, ${approvedText})"><label for="${approvedLabel}" class="custom-option-label">Approved</label><input class="custom-option" name="mrs-query-select" type="radio" id="${approvalLabel}" onchange="switchMRs(${approvalLabel}, ${query}, ${approvalText})"><label for="${approvalLabel}" class="custom-option-label">Approval rule</label></div></div>`;
    const mrsStateSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active${allChanged}" id="mrs-state-active">${activeState}</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-state-select" type="radio" id="${allLabel}-state" onchange="switchMRs(${allLabel}, ${state}, ${allText})"${allChecked}><label for="${allLabel}-state" class="custom-option-label">All</label><input class="custom-option" name="mrs-state-select" type="radio" id="${openedLabel}" onchange="switchMRs(${openedLabel}, ${state}, ${openedText})"${openChecked}><label for="${openedLabel}" class="custom-option-label">Open</label><input class="custom-option" name="mrs-state-select" type="radio" id="${mergedLabel}" onchange="switchMRs(${mergedLabel}, ${state}, ${mergedText})"><label for="${mergedLabel}" class="custom-option-label">Merged</label><input class="custom-option" name="mrs-state-select" type="radio" id="${closedLabel}" onchange="switchMRs(${closedLabel}, ${state}, ${closedText})"><label for="${closedLabel}" class="custom-option-label">Closed</label></div></div>`;
    const mrsSortSelect = `<div class="custom-select" tabindex="1"><div class="custom-select-active" id="mrs-sort-active">Sort by recently created</div><div class="custom-options-wrapper"><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyCreatedLabel}" onchange="switchMRs(${recentlyCreatedLabel}, ${sort}, ${recentlyCreatedText})"><label for="${recentlyCreatedLabel}" class="custom-option-label">Sort by recently created</label><input class="custom-option" name="mrs-sort-select" type="radio" id="${recentlyUpdatedLabel}" onchange="switchMRs(${recentlyUpdatedLabel}, ${sort}, ${recentlyUpdatedText})" checked><label for="${recentlyUpdatedLabel}" class="custom-option-label">Sort by recently updated</label></div></div>`;
    setElementHtml(
      '#sub-detail-headline',
      `<span class="name">${arg.page}</span>
        <div class="filter-sort">
          ${mrsQuerySelect}
          ${mrsStateSelect}
          ${mrsSortSelect}
        </div>`,
    );
    executeUnsafeJavaScript(
      'document.getElementById("sub-detail-headline").classList.add("with-overflow")',
    );
    displaySkeleton(numberOfMRs, undefined, 'sub-detail-content');
    getMRs(
      `${store.host}/api/v4/projects/${project.id}/merge_requests?scope=all&state=${activeMRsStateOption}&order_by=created_at&per_page=${numberOfMRs}&access_token=${store.access_token}`,
      'sub-detail-content',
    );
  }
});

ipcMain.on('back-to-detail-page', () => {
  isOnSubPage = false;
  activeIssuesQueryOption = 'assigned_to_me';
  activeMRsQueryOption = 'assigned_to_me';
});

ipcMain.on('go-to-overview', () => {
  if (store.analytics) {
    visitor.pageview('/').send();
  }
  getRecentlyVisited();
  getRecentComments();
  displayUsersProjects();
  getBookmarks();
  executeUnsafeJavaScript(
    'document.getElementById("detail-headline").classList.remove("with-overflow")',
  );
  executeUnsafeJavaScript(
    'document.getElementById("detail-header-content").classList.add("empty")',
  );
  setElementHtml('#detail-header-content', '');
  activeIssuesQueryOption = 'assigned_to_me';
  activeIssuesStateOption = 'opened';
  activeIssuesSortOption = 'created_at';
  activeMRsQueryOption = 'assigned_to_me';
  activeMRsStateOption = 'opened';
  activeMRsSortOption = 'created_at';
  moreRecentlyVisitedArray = [];
  recentProjectCommits = [];
  currentProjectCommit = null;
  currentProject = null;
});

ipcMain.on('go-to-settings', () => {
  openSettingsPage();
});

ipcMain.on('switch-issues', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch issues', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeIssuesQueryOption) {
    activeIssuesQueryOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-query-active', arg.text);
    if (
      (isOnSubPage === false && arg.label !== 'assigned_to_me') ||
      (isOnSubPage === true && arg.label !== 'all')
    ) {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-query-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'state' && arg.label !== activeIssuesStateOption) {
    activeIssuesStateOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeIssuesSortOption) {
    activeIssuesSortOption = arg.label;
    displaySkeleton(numberOfIssues, undefined, id);
    setElementHtml('#issues-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("issues-sort-active").classList.remove("changed")',
      );
    }
  }
  url += `issues?scope=${activeIssuesQueryOption}&state=${activeIssuesStateOption}&order_by=${activeIssuesSortOption}&per_page=${numberOfIssues}&access_token=${store.access_token}`;
  getIssues(url, id);
});

ipcMain.on('switch-mrs', (event, arg) => {
  if (store.analytics) {
    visitor.event('Switch merge requests', arg.type, arg.label).send();
  }
  let url = `${store.host}/api/v4/`;
  let id = 'detail-content';
  if (isOnSubPage && currentProject) {
    url += `projects/${currentProject.id}/`;
    id = 'sub-detail-content';
  }
  if (arg.type === 'query' && arg.label !== activeMRsQueryOption) {
    activeMRsQueryOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-query-active', arg.text);
    if (arg.label !== 'all') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-query-active").classList.remove("changed")',
      );
    }
  }
  if (arg.type === 'state' && arg.label !== activeMRsStateOption) {
    activeMRsStateOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-state-active', arg.text);
    if (arg.label !== 'opened') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-state-active").classList.remove("changed")',
      );
    }
  } else if (arg.type === 'sort' && arg.label !== activeMRsSortOption) {
    activeMRsSortOption = arg.label;
    displaySkeleton(numberOfMRs, undefined, id);
    setElementHtml('#mrs-sort-active', arg.text);
    if (arg.label !== 'created_at') {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.add("changed")',
      );
    } else {
      executeUnsafeJavaScript(
        'document.getElementById("mrs-sort-active").classList.remove("changed")',
      );
    }
  }
  url += 'merge_requests?scope=';
  if (activeMRsQueryOption === 'assigned_to_me' || activeMRsQueryOption === 'created_by_me') {
    url += activeMRsQueryOption;
  } else if (activeMRsQueryOption === 'approved_by_me') {
    url += `all&approved_by_ids[]=${store.user_id}`;
  } else if (activeMRsQueryOption === 'review_requests_for_me') {
    url += `all&reviewer_id=${store.user_id}`;
  } else if (activeMRsQueryOption === 'approval_rule_for_me') {
    url += `all&approver_ids[]=${store.user_id}`;
  }
  url += `&state=${activeMRsStateOption}&order_by=${activeMRsSortOption}&per_page=${numberOfMRs}&access_token=${store.access_token}`;
  getMRs(url, id);
});

ipcMain.on('switch-page', (event, arg) => {
  let id;
  if (isOnSubPage) {
    id = 'sub-detail-content';
  } else {
    id = 'detail-content';
  }
  if (arg.type === 'Todos') {
    displaySkeleton(numberOfTodos, true);
    getTodos(arg.url);
  } else if (arg.type === 'Issues') {
    displaySkeleton(numberOfIssues, true, id);
    getIssues(arg.url, id);
  } else if (arg.type === 'MRs') {
    displaySkeleton(numberOfMRs, true, id);
    getMRs(arg.url, id);
  } else if (arg.type === 'Comments') {
    displaySkeleton(numberOfComments, true);
    getMoreRecentComments(arg.url);
  }
});

ipcMain.on('search-recent', (event, arg) => {
  setElementHtml('#detail-content', '');
  searchRecentlyVisited(arg);
});

ipcMain.on('change-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate my commits', 'next').send();
    } else {
      visitor.event('Navigate my commits', 'previous').send();
    }
  }
  setElementHtml(
    '#pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentCommits, currentCommit);
  currentCommit = nextCommit;
  getCommitDetails(nextCommit.project_id, nextCommit.push_data.commit_to, nextCommit.index);
});

ipcMain.on('change-project-commit', (event, arg) => {
  if (store.analytics) {
    if (arg) {
      visitor.event('Navigate project commits', 'next').send();
    } else {
      visitor.event('Navigate project commits', 'previous').send();
    }
  }
  setElementHtml(
    '#project-pipeline',
    '<div class="commit empty"><div class="commit-information"><div class="commit-name skeleton"></div><div class="commit-details skeleton"></div></div><div id="project-name"></div></div>',
  );
  const nextCommit = changeCommit(arg, recentProjectCommits, currentProjectCommit);
  currentProjectCommit = nextCommit;
  getProjectCommitDetails(currentProject.id, nextCommit.id, nextCommit.index);
});

ipcMain.on('add-bookmark', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add bookmark').send();
  }
  addBookmark(arg);
});

ipcMain.on('add-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add project').send();
  }
  addProject(arg.input, arg.target);
});

ipcMain.on('add-shortcut', (event, arg) => {
  if (store.analytics) {
    visitor.event('Add shortcut').send();
  }
  addShortcut(arg);
});

ipcMain.on('start-bookmark-dialog', () => {
  startBookmarkDialog();
});

ipcMain.on('start-project-dialog', () => {
  startProjectDialog();
});

ipcMain.on('start-shortcut-dialog', () => {
  startShortcutDialog();
});

ipcMain.on('delete-bookmark', (event, hashedUrl) => {
  if (store.analytics) {
    visitor.event('Delete bookmark').send();
  }
  if (store.bookmarks && store.bookmarks.length > 0) {
    const newBookmarks = store.bookmarks.filter(
      (bookmark) => sha256hex(bookmark.web_url) !== hashedUrl,
    );
    store.bookmarks = newBookmarks;
  }
  getBookmarks();
});

ipcMain.on('delete-project', (event, arg) => {
  if (store.analytics) {
    visitor.event('Delete project').send();
  }
  const projects = store['favorite-projects'];
  const newProjects = projects.filter((project) => project.id !== arg);
  store['favorite-projects'] = newProjects;
  // TODO Implement better way to refresh view after deleting project
  displayUsersProjects();
  openSettingsPage();
});

ipcMain.on('delete-shortcut', (event, arg) => {
  store.shortcuts = store.shortcuts.filter((keys) => keys !== arg);
  setupCommandPalette();
  repaintShortcuts();
});

ipcMain.on('change-theme', (event, arg) => {
  if (store.analytics) {
    visitor.event('Change theme', arg).send();
  }
  changeTheme(arg, true);
});

ipcMain.on('change-analytics', (event, arg) => {
  store.analytics = arg;
  if (store.analytics) {
    visitor = ua('UA-203420427-1', store.analytics_id);
  } else {
    visitor = null;
  }
});

ipcMain.on('change-keep-visible', (event, arg) => {
  store.keep_visible = arg;
  mb.window.setAlwaysOnTop(arg);
});

ipcMain.on('change-show-dock-icon', (event, arg) => {
  mb.window.setAlwaysOnTop(true);
  store.show_dock_icon = arg;
  if (arg) {
    app.dock.show().then(() => {
      mb.window.setAlwaysOnTop(store.keep_visible);
    });
  } else {
    app.dock.hide();
    app.focus({
      steal: true,
    });
    setTimeout(() => {
      app.focus({
        steal: true,
      });
      mb.window.setAlwaysOnTop(store.keep_visible);
    }, 200);
  }
});

ipcMain.on('choose-certificate', () => {
  chooseCertificate();
});

ipcMain.on('reset-certificate', () => {
  executeUnsafeJavaScript('document.getElementById("custom-cert-path-text").innerText=""');
  executeUnsafeJavaScript(
    'document.getElementById("custom-cert-path-text").classList.add("hidden")',
  );
  chooseCertificate();
});

ipcMain.on('start-login', () => {
  startLogin();
});

ipcMain.on('start-manual-login', (event, arg) => {
  if (arg.custom_cert_path) {
    saveUser(arg.access_token, arg.host, arg.custom_cert_path);
  } else {
    saveUser(arg.access_token, arg.host);
  }
});

ipcMain.on('logout', () => {
  if (store.analytics) {
    visitor.event('Log out', true).send();
  }
  logout();
});
