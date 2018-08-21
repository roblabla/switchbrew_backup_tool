var WikiTextParser = require('parse-wikitext')
var fs = require("fs").promises;
var mkdirp = require("mkdirp");
var util = require("util")
var promisify = util.promisify;
var git = require('simple-git/promise');

var target = "switchbrew.org"
var wikiTextParser = new WikiTextParser(target);

var repo_path = "git_repo"; // argv[2]

async function getRevisions(title) {
  console.log("Dumping revisions of " + title + "...")
  let data = await promisify(wikiTextParser.client.getArticleRevisions.bind(wikiTextParser.client))(title);
  return { title, revisions: data };
}

async function main() {
  let data = await promisify(wikiTextParser.client.getAllPages.bind(wikiTextParser.client))();

  try {
    await fs.mkdir(repo_path);
  } catch (e) {
    if (e.code != 'EEXIST') { throw e }
  }
  var repo = git(repo_path);
  if (!await repo.checkIsRepo()) {
    await repo.init();
  }

  await repo.reset("hard");
  await repo.clean("f", "-xd");

  let revisionsByArticle = await Promise.all(data.map(article => getRevisions(article.title)));

  var revisions = [];
  for (let article of revisionsByArticle) {
    for (let revision of article.revisions) {
      revisions.push({ title: article.title, rev: revision });
    }
  }

  var last_rev = 0;
  try {
    last_rev = parseInt(await fs.readFile(`${repo_path}/.cur_revision`));
  } catch (e) {
    if (e.code != 'ENOENT') { throw e }
  }

  revisions.sort((a, b) =>
    a.rev.revid - b.rev.revid);

  revisions = revisions.filter(v => last_rev < v.rev.revid);

  for (var rev of revisions) {
    console.log(`Handling revision ID ${rev.rev.revid} for article ${rev.title} at timestamp ${rev.rev.timestamp}`);
    var timestampDate = Date.parse(rev.rev.timestamp);

    var fsTitle = rev.title.replace(/[\\$'"]/g, "\\$&").replace(/[/|:]/g, " ")

    let revText = await util.promisify(wikiTextParser.getFixedArticle.bind(wikiTextParser))(rev.title, rev.rev.timestamp);
    await fs.writeFile(`${repo_path}/${fsTitle}.txt`, revText);
    await fs.writeFile(`${repo_path}/.cur_revision`, rev.rev.revid.toString());

    await repo.add(`${fsTitle}.txt`);
    await repo.add(`.cur_revision`);
    await repo.commit(rev.rev.comment || `Update to ${rev.title}`, { '--author': `"${rev.rev.user} <switchbrew_backup@roblab.la>"`, '--date': rev.rev.timestamp });
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
