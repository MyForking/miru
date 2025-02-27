import { alToken } from '@/lib/Settings.svelte'
import { addToast } from '@/lib/Toasts.svelte'
import lavenshtein from 'js-levenshtein'

import Bottleneck from 'bottleneck'

const codes = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Moved Temporarily',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Time-out',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Large',
  415: 'Unsupported Media Type',
  416: 'Requested Range Not Satisfiable',
  417: 'Expectation Failed',
  418: 'I\'m a teapot',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Unordered Collection',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Time-out',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required'
}

export const alID = !!alToken && alRequest({ method: 'Viewer', token: alToken })
if (alID) {
  alID.then(result => {
    const lists = result?.data?.Viewer?.mediaListOptions?.animeList?.customLists || []
    if (!lists.includes('Watched using Miru')) {
      alRequest({ method: 'CustomList', lists })
    }
  })
}

function printError (error) {
  console.warn(error)
  addToast({
    text: /* html */`Failed making request to anilist!<br>Try again in a minute.<br>${error.status} - ${error.message || codes[error.status]}`,
    title: 'Search Failed',
    type: 'danger',
    duration: 3000
  })
}

const limiter = new Bottleneck({ maxConcurrent: 100, minTime: 600 })
const limit = limiter.wrap(handleRequest)

async function handleRequest (opts) {
  const res = await fetch('https://graphql.anilist.co', opts)
  if (!res.ok && res.status === 429) return await limit(opts)
  let json = null
  try {
    json = await res.json()
  } catch (error) {
    if (res.ok) printError(error)
  }
  if (!res.ok) {
    if (json) {
      for (const error of json?.errors || []) {
        printError(error)
      }
    } else {
      printError(res)
    }
  }
  return json
}

export function alEntry (filemedia) {
  // check if values exist
  if (filemedia.media && alToken) {
    const { media } = filemedia
    // check if media can even be watched, ex: it was resolved incorrectly
    if (media.status === 'FINISHED' || media.status === 'RELEASING') {
      // some anime/OVA's can have a single episode, or some movies can have multiple episodes
      const singleEpisode = (!media.episodes || (media.format === 'MOVIE' && media.episodes === 1)) && 1
      const videoEpisode = Number(filemedia.episode) || singleEpisode
      const mediaEpisode = media.nextAiringEpisode?.episode || media.episodes || singleEpisode
      // check episode range
      if (videoEpisode && mediaEpisode && (mediaEpisode >= videoEpisode)) {
        // check user's own watch progress
        const lists = media.mediaListEntry?.customLists.filter(list => list.enabled).map(list => list.name) || []
        if (!media.mediaListEntry || (media.mediaListEntry?.progress <= videoEpisode) || singleEpisode) {
          const variables = {
            method: 'Entry',
            repeat: media.mediaListEntry?.repeat || 0,
            id: media.id,
            status: 'CURRENT',
            episode: videoEpisode,
            lists
          }
          if (videoEpisode === mediaEpisode) {
            variables.status = 'COMPLETED'
            if (media.mediaListEntry?.status === 'REPEATING') variables.repeat = media.mediaListEntry.repeat + 1
          }
          if (!lists.includes('Watched using Miru')) {
            variables.lists.push('Watched using Miru')
          }
          alRequest(variables)
        }
      }
    }
  }
}

function getDistanceFromTitle (media, name) {
  if (media) {
    const distances = [...Object.values(media.title), ...media.synonyms].filter(v => v).map(title => lavenshtein(title.toLowerCase(), name.toLowerCase()))
    const min = distances.reduce((prev, curr) => prev < curr ? prev : curr)
    media.lavenshtein = min
    return media
  }
}

export async function alSearch (method) {
  const res = await alRequest(method)
  const media = res.data.Page.media.map(media => getDistanceFromTitle(media, method.name))
  if (!media.length) return res
  const lowest = media.reduce((prev, curr) => prev.lavenshtein < curr.lavenshtein ? prev : curr)
  return { data: { Page: { media: [lowest] } } }
}

export async function alRequest (opts) {
  let query
  const variables = {
    type: 'ANIME',
    sort: opts.sort || 'TRENDING_DESC',
    page: opts.page || 1,
    perPage: opts.perPage || 30,
    status_in: opts.status_in || '[CURRENT,PLANNING]',
    chunk: opts.chunk || 1,
    perchunk: opts.perChunk || 30
  }
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  }
  const queryObjects = /* js */`
id,
title {
  romaji,
  english,
  native,
  userPreferred
},
description(asHtml: false),
season,
seasonYear,
format,
status,
episodes,
duration,
averageScore,
genres,
coverImage {
  extraLarge,
  medium,
  color
},
countryOfOrigin,
isAdult,
bannerImage,
synonyms,
nextAiringEpisode {
  timeUntilAiring,
  episode
},
trailer {
  id,
  site
},
streamingEpisodes {
  title,
  thumbnail
},
mediaListEntry {
  id,
  progress,
  repeat,
  status,
  customLists(asArray: true),
  score(format: POINT_10)
},
source,
studios(isMain: true) {
  nodes {
    name
  }
},
airingSchedule(page: 1, perPage: 1, notYetAired: true) {
  nodes {
    episode
  }
},
relations {
  edges {
    relationType(version:2)
    node {
      id,
      title {
        userPreferred
      },
      coverImage {
        medium
      },
      type,
      status,
      format,
      episodes,
      startDate {
        year,
        month,
        day
      },
      endDate {
        year,
        month,
        day
      }
    }
  }
},
recommendations {
  edges {
    node {
      mediaRecommendation {
        id,
        title {
          userPreferred
        },
        coverImage {
          medium
        }
      }
    }
  }
}`
  if (opts.status) variables.status = opts.status
  if (localStorage.getItem('ALtoken')) options.headers.Authorization = alToken
  switch (opts.method) {
    case 'SearchName': {
      variables.search = opts.name
      query = /* js */` 
query ($page: Int, $perPage: Int, $sort: [MediaSort], $type: MediaType, $search: String, $status: [MediaStatus]) {
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    },
    media(type: $type, search: $search, sort: $sort, status_in: $status, isAdult: false) {
      ${queryObjects}
    }
  }
}`
      break
    } case 'SearchIDSingle': {
      variables.id = opts.id
      query = /* js */` 
query ($id: Int, $type: MediaType) { 
  Media (id: $id, type: $type) {
    ${queryObjects}
  }
}`
      break
    } case 'SearchIDS': {
      variables.id = opts.id
      query = /* js */` 
query ($id: [Int], $type: MediaType, $page: Int, $perPage: Int) { 
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    },
    media (id_in: $id, type: $type) {
      ${queryObjects}
    }
  }
}`
      break
    } case 'Viewer': {
      variables.id = alToken
      query = /* js */` 
query {
  Viewer {
    avatar {
      medium
    },
    name,
    id,
    mediaListOptions {
      animeList {
        customLists
      }
    }
  }
}`
      break
    } case 'UserLists': {
      variables.id = (await alID)?.data?.Viewer?.id
      query = /* js */` 
query ($page: Int, $perPage: Int, $id: Int, $type: MediaType, $status_in: [MediaListStatus]){
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    },
    mediaList (userId: $id, type: $type, status_in: $status_in, sort: UPDATED_TIME_DESC) {
      media {
        ${queryObjects}
      }
    }
  }
}`
      break
    } case 'SearchIDStatus': {
      variables.id = (await alID)?.data?.Viewer?.id
      variables.mediaId = opts.id
      query = /* js */` 
query ($id: Int, $mediaId: Int){
  MediaList(userId: $id, mediaId: $mediaId) {
    status,
    progress,
    repeat
  }
}`
      break
    } case 'AiringSchedule': {
      variables.from = opts.from
      variables.to = (variables.from + 7 * 24 * 60 * 60)
      query = /* js */` 
query ($page: Int, $perPage: Int, $from: Int, $to: Int) {
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    },
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to) {
      episode,
      timeUntilAiring,
      airingAt,
      media{
        ${queryObjects}
      }
    }
  }
}`
      break
    } case 'Search': {
      variables.genre = opts.genre
      variables.search = opts.search
      variables.year = opts.year
      variables.season = opts.season
      variables.format = opts.format
      variables.sort = opts.sort || 'SEARCH_MATCH'
      query = /* js */` 
query ($page: Int, $perPage: Int, $sort: [MediaSort], $type: MediaType, $search: String, $status: MediaStatus, $season: MediaSeason, $year: Int, $genre: String, $format: MediaFormat) {
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
    },
    media(type: $type, search: $search, sort: $sort, status: $status, season: $season, seasonYear: $year, genre: $genre, format: $format) {
      ${queryObjects}
    }
  }
}`
      break
    } case 'Entry': {
      variables.repeat = opts.repeat
      variables.id = opts.id
      variables.status = opts.status
      variables.episode = opts.episode
      variables.score = opts.score
      variables.lists = opts.lists
      query = /* js */`
      mutation ($lists: [String], $id: Int, $status: MediaListStatus, $episode: Int, $repeat: Int, $score: Int) {
        SaveMediaListEntry (mediaId: $id, status: $status, progress: $episode, repeat: $repeat, scoreRaw: $score, customLists: $lists) {
          id,
          status,
          progress,
          repeat
        }
      }`
      break
    } case 'Delete': {
      variables.id = opts.id
      query = /* js */`
      mutation ($id: Int) {
        DeleteMediaListEntry (id: $id){
          deleted
        }
      }`
      break
    } case 'Following': {
      variables.id = opts.id
      query = /* js */`
      query($id: Int) {
        Page {
          pageInfo {
            total,
            perPage,
            currentPage,
            lastPage,
            hasNextPage
          },
          mediaList(mediaId: $id, isFollowing: true, sort: UPDATED_TIME_DESC) {
            id,
            status,
            score,
            progress,
            user {
              id,
              name,
              avatar {
                medium
              },
              mediaListOptions {
                scoreFormat
              }
            }
          }
        }
      }`
      break
    } case 'CustomList':{
      variables.lists = [...opts.lists, 'Watched using Miru']
      query = /* js */`
      mutation($lists: [String]) {
        UpdateUser(animeListOptions: { customLists: $lists }){
          id
        }
      }`
      break
    }
  }
  options.body = JSON.stringify({
    query: query.replace(/\s/g, ''),
    variables
  })

  return await handleRequest(options)
}
