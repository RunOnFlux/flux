const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Repositories', () => {
  const repositoriesPath = path.join(__dirname, '../../helpers/repositories.json');

  it('should load repositories from JSON file', () => {
    // Read the repositories.json file
    const repositoriesJson = fs.readFileSync(repositoriesPath, 'utf8');

    // Parse JSON data
    const repositories = JSON.parse(repositoriesJson);

    // Assert that repositories is an array
    expect(repositories).to.be.an('array');

    // Assert that the number of repositories is greater than 0
    expect(repositories).to.have.length.above(0);
  });

  it('should not contain duplicates', () => {
    // Read the repositories.json file
    const repositoriesJson = fs.readFileSync(repositoriesPath, 'utf8');

    // Parse JSON data
    const repositories = JSON.parse(repositoriesJson);

    // Check for duplicates
    const duplicates = repositories.filter((value, index, self) => self.indexOf(value) !== index);

    // Assert that there are no duplicates
    expect(duplicates).to.be.an('array').that.is.empty;
  });
});
