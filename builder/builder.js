const fs = require('fs')
const types = require('./types')

const routes = require('./routes.json')
const _ = require('lodash')
const plus = require('../src/plus')

// Map of URL -> Method -> Params
const converted = {}

// Extract the info we need from routes.json
Object.keys(routes).forEach((key1) => {
  Object.keys(routes[key1]).forEach((key2) => {

    const {url, method, params} = routes[key1][key2]

    if (url) {
      converted[url] = converted[url] || {}
      converted[url][method] = _.omitBy(params, (value, keyName) => keyName.startsWith('$'))
    }
  })
})


// Construct the tree we will need
const convertedTree = {/*childrenWithoutArgs: {}, childrenWithArgs: {}*/}

// It will have a format similar to:
// {
//   'repos': {
//     childrenWithArgs: {
//       ':owner/:name': CHILD_NODE
//     }
//     childrenWithoutArgs: {
//       'issues': CHILD_NODE
//     },
//     methods: {
//       'get': PARAMS
//     }
//   },
// }

Object.keys(converted).forEach((route) => {
  // const {GET, POST, DELETE, PATCH, PUT} = converted[route]

  if (route === "/repos/:owner/:repo/hooks") {
    debugger
  }

  function addArgsSegment(treeNode, argsSegment) {
    treeNode.childrenWithArgs = treeNode.childrenWithArgs || {}
    const childNode = treeNode.childrenWithArgs[argsSegment] || {/*childrenWithArgs: {}, childrenWithoutArgs: {}, methods: {}*/}
    treeNode.childrenWithArgs[argsSegment] = childNode // add if does not exist yet

    if (Object.keys(treeNode.childrenWithArgs).length > 1) {
      // woah, multiple functions. Let's check if they have the same number of args
      console.log('Duplicates for', segments.slice(1, segmentIndex).join('/'), Object.keys(treeNode.childrenWithArgs));
    }
    return childNode
  }

  function addSegment(treeNode, segment) {
    treeNode.childrenWithoutArgs = treeNode.childrenWithoutArgs || {}
    const childNode = treeNode.childrenWithoutArgs[segment] || {/*childrenWithArgs: {}, childrenWithoutArgs: {}, methods: {}*/}
    treeNode.childrenWithoutArgs[segment] = childNode // add if does not exist yet
    return childNode
  }


  const segments = route.split('/')
  let treeNode = convertedTree
  let segmentIndex = 1 // because each route begins with a '/'
  let args = [] // these get added on and then cleared as we walk through the route
  while (segments[segmentIndex]) {
    const segment = segments[segmentIndex]
    if (segment[0] === ':') {
      // it is an argument
      args.push(segment)
    } else {
      if (args.length > 0) {
        const argsSegment = args.join('/')

        treeNode = addArgsSegment(treeNode, argsSegment)
        args = []

      }

      treeNode = addSegment(treeNode, segment)
      args = []
    }
    segmentIndex++
  }

  // Copy/pasta from above
  if (args.length > 0) {
    const argsSegment = args.join('/')

    treeNode = addArgsSegment(treeNode, argsSegment)
    args = []
  }


  // Attach the methods to the node
  treeNode._route = route
  treeNode.methods = converted[route]
})

console.log(JSON.stringify(convertedTree));




types.forEach((type) => {
  // typeName: 'InputRepo'
  // fnArgs: null
  // children: {
  //   'issues': 'InputRepoIssues'
  //   'git': 'InputGit'
  // }
  // verbs:
  //   fetch:
  //     fnArgs: []
  //     resultType: 'RepoResponse'
  //   remove:
  //     fnArgs: []
  //     resultType: 'void'


  const importTypes = {}

  const instanceChildren = []
  const instanceChildrenInterfaceDeclarations = []
  const instanceChildrenDeclarations = []
  Object.keys(type.children || {}).forEach((instanceChildName) => {
    const instanceChildType = type.children[instanceChildName]
    importTypes[instanceChildType] = true
    instanceChildren.push(`this.${instanceChildName} = new ${instanceChildType}(basePath + '/${instanceChildName}')`)
    instanceChildrenInterfaceDeclarations.push(`${instanceChildName} : I${instanceChildType}`)
    instanceChildrenDeclarations.push(`${instanceChildName} : ${instanceChildType}(basePath + '/${instanceChildName}')`)
  })

  const verbMethods = []
  const verbMethodInterfaces = []
  Object.keys(type.verbs || {}).forEach((verbMethodKey) => {
    const {fnArgs, resultType} = type.verbs[verbMethodKey]
    importTypes[resultType.replace('[]', '')] = true // Strip off arrays
    const resultTypeNoVoid = resultType === 'void' ? 'void' : `I${resultType}`
    verbMethodInterfaces.push(`${verbMethodKey}(/*args*/) : Promise<${resultTypeNoVoid}>`)
    verbMethods.push(`${verbMethodKey}(/*args*/) : Promise<${resultTypeNoVoid}> { return VERBS._${verbMethodKey}<${resultTypeNoVoid}>(basePath) }`)
  })

  const instanceMethodsStr = '/* Not implemented yet */'


  let functionArgsAndReturn = ''

  if (type.returnType) {
    importTypes[type.returnType] = true

    let index = 1
    const args = []
    type.fnArgs.forEach(({type}) => {
      args.push(`arg${index}: ${type}`)
      index += 1
    })

    functionArgsAndReturn = `(${args.join(', ')}): I${type.returnType}`
  }

  const instanceRequires = Object.keys(importTypes)
  .filter((importType) => importType != 'void') // remove the void type
  .map((importType) => `import {I${importType}, ${importType}} from './${importType}'`)

  let source = `
// This file is autogenerated
import * as VERBS from '../verbs'
${instanceRequires.join('\n')}

export interface I${type.typeName} {
  ${functionArgsAndReturn}

  ${instanceChildrenInterfaceDeclarations.join('\n')}

  ${verbMethodInterfaces.join('\n')}
}
  `


  let functionDefinition = ''
  if (type.returnType) {
    // Cannot just create a simple class. Need to create a function and then Object.merge the props onto it
    // http://stackoverflow.com/a/41853194 in https://stackoverflow.com/questions/12766528/build-a-function-object-with-properties-in-typescript#18640025

    let index = 1
    const args = []
    const pathExpander = []
    type.fnArgs.forEach(({type}) => {
      args.push(`arg${index}: ${type}`)
      pathExpander.push(`arg${index}`)
      index += 1
    })


    functionDefinition = `
(${args.join(', ')}) => {
  return ${type.returnType}(basePath + '/' + ${pathExpander.join(" + '/' + ")})
},
    `

  }
//     // Create a simple class
//     source += `
// export class ${type.typeName} {
//    _basePath: string
//    ${instanceChildrenInterfaceDeclarations.join('\n')}
//    constructor(basePath : string) {
//      this._basePath = basePath
//      ${instanceChildren.join('\n')}
//    }
//
//    ${instanceMethodsStr}
//
//    ${verbMethods.join('\n')}
// }
// `


  source += `
export const ${type.typeName} = (basePath : string): I${type.typeName} => {
  return Object.assign(
    ${functionDefinition}
    {
      ${instanceChildrenDeclarations.concat(verbMethods).join(',\n')}
    }
  )
}
`




  fs.writeFileSync(`${__dirname}/generated-ts/${type.typeName}.ts`, source)
})