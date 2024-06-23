// mysql:latest
const ociIndex = {
  manifests: [
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'amd64',
        'org.opencontainers.image.base.digest':
          'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-01T01:49:08Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'amd64', os: 'linux' },
      size: 2855,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'amd64',
        'vnd.docker.reference.digest':
          'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:fc88aa38fce5a0c3be54d4cfd0dda9c351854c5d28285509baedf4f322f7d755',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'arm64v8',
        'org.opencontainers.image.base.digest':
          'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-02T00:58:55Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'arm64', os: 'linux', variant: 'v8' },
      size: 2857,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'arm64v8',
        'vnd.docker.reference.digest':
          'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:01efa5c8f1824bd63acbd8736a48cb22f117881b7574b0052a385b7251dc1061',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
  ],
  mediaType: 'application/vnd.oci.image.index.v1+json',
  schemaVersion: 2,
};

// mysql:latest
const ociManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:07bc88e18c4aea4343fc16a9930da57308d4df45d3d234aebcd5b1c1833ee290',
      size: 48994878,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1a9c1668bf493c4df11d8a9377aeb8ef94c277c39d700470d6757f4affe812fa',
      size: 881,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1021dda8eecff015672845c8c131d475eccb83c09569a18640c2cda4399decf2',
      size: 983004,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:fb61b56acac1145d05c716918b447019808fac364743d1232e647845748f5020',
      size: 6711529,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0bca83908a5b1425517e978c51f3b8631610670037c49db9c3663a7915e20c53',
      size: 2602,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:165e8b3d37ca389e737cbc06dbd776556f3fb96311ed68ea52825fbc64685450',
      size: 333,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:3e1b086f129564f4f57b1cf79b288cf54a9e5c3a1c43219db46a1b493d40cded',
      size: 47215103,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:dba6516684849c81829a8787e5e56a203bad4854df16430fa2e3ca837d94e1d4',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:ed90f5355e12edb07b8cdaa438ef1d088e2e3121ed5b04904aaf98e79555c572',
      size: 64786544,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0412f59ab2b5360b2f2648828b0e7dd7483aa35d13a6623fcc7752d23414e9ea',
      size: 5185,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'amd64',
    'org.opencontainers.image.base.digest':
      'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// mysql:latest
const ociManifestArm64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:61a4ee8acd701eff541d0679dda9fad4d2d0843caedad36ebd17a7b41ec4b9fa',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:da7a98631edf9304544ff835ff2891b9c7a6773ae8a8bbd8041b6ef3af01fae9',
      size: 47651991,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:226e339470841aa621f212ffd8e76f35790c7a28104dd97996ad2853894f3ba6',
      size: 884,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:2eeb0cf07c9beeda8d94a25c9e65966dd25ea12f1429af47a54670924b481a81',
      size: 913449,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0d54108df510677120ec7ac21fcf4d0eb9453a8dd56db90cdfd435daf38da8fb',
      size: 6312392,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:2e523b6e86dbd0b1cb06b5674ae8fa8aa116da11a25ecbd8dd53457590f2571a',
      size: 2609,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:82dcf16e72cf33448e9f33b8c62b6c1552cb81a66ff80daa0eece2c353874e6a',
      size: 332,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:4e8f1c8c168a546aca98897bb3330afc7e0075abe929da8fdd0679a7a00825c3',
      size: 46082893,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:326faf5381746f13b1257ec7df0b686db4d7ecdae64b4528f0ed0f79893670e6',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:d91dac12e95143ff54548a09769dbfad4fb1dbd593be311bc8233dd53d8cf25c',
      size: 64959326,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:643e46c3934422f23e956fd47bcd992c86c30115678c3c9aa81b91a5b6460a23',
      size: 5182,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'arm64v8',
    'org.opencontainers.image.base.digest':
      'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// phpmyadmin:latest
const distributionManifestList = {
  manifests: [
    {
      digest:
        'sha256:2c62993fdc4eef2077030894893391a8d1b4b785106f25495af734e474c7c019',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'amd64', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:ac86587c8ae0ab295ea8f71fdf133f4adf5d3a289c5b97cd5555623eef8fe2dc',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm', os: 'linux', variant: 'v5' },
      size: 4080,
    },
    {
      digest:
        'sha256:2a74670d7b4eb4abe0cdf656d60370b21728e810a61704a618d01df9bb5b017e',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm', os: 'linux', variant: 'v7' },
      size: 4079,
    },
    {
      digest:
        'sha256:fe983a72f65856381bbf5376f5bd1f3a6961ee83bfd7f0d35e087ac655b3688a',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm64', os: 'linux', variant: 'v8' },
      size: 4080,
    },
    {
      digest:
        'sha256:94a416e0f2a6ffc28e68f86616739cd211eab91ad092e23ac92a6c2759a2a5e4',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: '386', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:2fec163305d0361a996ee6877b410e55ceec18e715e7c536e55289450880f7f3',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 4080,
    },
    {
      digest:
        'sha256:7ae932f82ae089a9558f27b1e08024931ea81b2a70599498db904dee53a91044',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'ppc64le', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:d30203e99d1457ce1e56c3f0c829b05e09771a88b1ea9b09d1b609fa6b6e43b6',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 's390x', os: 'linux' },
      size: 4080,
    },
  ],
  mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
  schemaVersion: 2,
};

// phpmyadmin:latest
const distributionManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22062,
    digest:
      'sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29150411,
      digest:
        'sha256:09f376ebb190216b0459f470e71bec7b5dfa611d66bf008492b40dcc5f1d8eae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 225,
      digest:
        'sha256:76afcdc8655129b4b8245d674820f06020b8a54f3db6c8d9147234b985f3c923',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 104357718,
      digest:
        'sha256:ceed4541c527d7a443908138f347495ec250ba7a1e70d8dd6b567464064ee115',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 270,
      digest:
        'sha256:9ec84be954b08b2782f93426799a585ad7b33b0e7d57b3f725218d450ea5d20d',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20329735,
      digest:
        'sha256:ff0e278869f981b14b52a6f43e6a0ce131ed2f3067de4314ed34393669549724',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 474,
      digest:
        'sha256:1693466e4cc6edc54994f2c9c9e1989f28b0df6243b3c709876e36a999aac7ee',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 510,
      digest:
        'sha256:57c8d94a4882fa141e8c25a4a5ea1f1188629cc772674bdc7dcd69c13a07bd25',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428793,
      digest:
        'sha256:43af3fe8136ad9261342f5add4a18489a3ffc70ba50f2651ea7cc1b3d0e45875',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:ddef75e08a5d03695ba1b0ce20598e067646188c87a8367b98c0b1768a280b7f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 11407606,
      digest:
        'sha256:a4ba0bdbbf0a7e73b6acc7dcd82c8dbc4635884963f73bbebcbac1a2f988cf99',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:29e89bc69515a29ca19a9f9d5159e84862484ce94772369f8eb8ea55471b22ae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 246,
      digest:
        'sha256:bdad2781572257d109331576ace9e6292ca5bab9a8d069e9f59bf185db3c1b29',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 893,
      digest:
        'sha256:dbbbc9a8833202619954978f80ebc0a2284f0e0b248972d29a930f7461853b61',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3212419,
      digest:
        'sha256:dbb7df25a76e3f547e39f1d1c6446fec585440ab4bda3ce2d3cf9a860ab7c990',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 582,
      digest:
        'sha256:2cedf1ee513bf5eda7415e9d81a011565ce786aca7d29688d54b7569b64e0179',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016080,
      digest:
        'sha256:b29f15d25d619f8fdbf3f5241916c85e91a1e7f13c4ca7809f81c0c8cf43049c',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:0c455ba0c479f0e90ff42487c0bbc46a9a6fb9479e687ad62b883c85b1c2dd38',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 928,
      digest:
        'sha256:87f4d138451a04e398076c63aae11f592e796f19b6c4be27457ef128df3736da',
    },
  ],
};

// phpmyadmin:latest
const distributionManifestArm64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22081,
    digest:
      'sha256:45f016fd20cba4a17403b716b3cf1145e57812012934a79bb80b7b4a10f5438a',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29179503,
      digest:
        'sha256:24c63b8dcb66721062f32b893ef1027404afddd62aade87f3f39a3a6e70a74d0',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 227,
      digest:
        'sha256:39b7dc80a604e2d946f854c281d86a632c7990a3102971c1d4e21a1d38646608',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 98132609,
      digest:
        'sha256:344cef50aac5b8a976b3c008872a172409dee8a59088b27d80f3eea602550bd1',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 268,
      digest:
        'sha256:7f8858b20eb874693369b0e22400077725368077e44fbc30d7bf0e7120e77bc1',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20322465,
      digest:
        'sha256:33ffd5ecc100a124cb73cfac0e4259b830e97946a60c2cfad58e7e466e15cba7',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 471,
      digest:
        'sha256:0979b7b79b87f64b24acab726c0370bdd80c82efe2602c6bdf36b549c62cad91',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 513,
      digest:
        'sha256:f418b51bb40328f0c0d56bbd29006fdf292ff649fc38836189e89f33c27c0a94',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428430,
      digest:
        'sha256:8238673353aa1e651316a7785a8be3df8380c10e0b09544d58a02e6c8cf9e5bc',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:792849d38ff0788197ea6bc2d40206ddbd4cfb081b964dcc0f3c767e39efbfbf',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 11414533,
      digest:
        'sha256:537518cc819e577b0936cb81f2beffa78563e19a75596951c080546afee7d5e2',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:babe5c9e46f997637b40d1490e4e8594c3053273ec903619dc0c2f1e8b013ff4',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 247,
      digest:
        'sha256:841e0f2798e209d0e893edcbb6abf62f9f2bd79e0e0dbf40cfe86c55c69d7a63',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 894,
      digest:
        'sha256:b278bf9d6faf7def4938b8616cb27e1ddee2000e7ec06afc3463fa5d4532588f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3462603,
      digest:
        'sha256:4f99e97c6ba74f6dc3679e233e80ebe40c133681417e72301cfefe75fd9a78a4',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 583,
      digest:
        'sha256:21765477835bb1764c2979ccac2c584868a9c8bde7c5f2cedc5190d5dd70ae4f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016151,
      digest:
        'sha256:1aee002f2df3fbb431ee148eb79ae56077ea1f922b4dcddfb736a2168fe72cf7',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:f855ac4c0ab6239868635a71af6106bdf0b22894e7ef802333ea4ba589862f5a',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 930,
      digest:
        'sha256:23ffa052a82622734de8425815a9a4c8d1d5088ef1361ec1dab3532a1bed007e',
    },
  ],
};

// phpmyadmin:latest (config)

const imageConfigArm64 = {
  architecture: 'arm64',
  config: {
    Hostname: '',
    Domainname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: {
      '80/tcp': {},
    },
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      'PHP_INI_DIR=/usr/local/etc/php',
      'APACHE_CONFDIR=/etc/apache2',
      'APACHE_ENVVARS=/etc/apache2/envvars',
      'PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_LDFLAGS=-Wl,-O1 -pie',
      'GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      'PHP_VERSION=8.2.20',
      'PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz',
      'PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      'PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      'MAX_EXECUTION_TIME=600',
      'MEMORY_LIMIT=512M',
      'UPLOAD_LIMIT=2048K',
      'TZ=UTC',
      'SESSION_SAVE_PATH=/sessions',
      'VERSION=5.2.1',
      'SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      'URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
    ],
    Cmd: [
      'apache2-foreground',
    ],
    Image: 'sha256:2c67feea200e7de40c61fc910b8db697eff54b870cc81a18b44b2969eab60db2',
    Volumes: null,
    WorkingDir: '/var/www/html',
    Entrypoint: [
      '/docker-entrypoint.sh',
    ],
    OnBuild: null,
    Labels: {
      'org.opencontainers.image.authors': 'The phpMyAdmin Team <developers@phpmyadmin.net>',
      'org.opencontainers.image.description': 'Run phpMyAdmin with Alpine, Apache and PHP FPM.',
      'org.opencontainers.image.documentation': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.licenses': 'GPL-2.0-only',
      'org.opencontainers.image.source': 'https://github.com/phpmyadmin/docker.git',
      'org.opencontainers.image.title': 'Official phpMyAdmin Docker image',
      'org.opencontainers.image.url': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.vendor': 'phpMyAdmin',
      'org.opencontainers.image.version': '5.2.1',
    },
    StopSignal: 'SIGWINCH',
  },
  container: 'bf2c88c233a939715e7f193db8aea54c74548d65b865be8432a674ca80f8f3ba',
  container_config: {
    Hostname: 'bf2c88c233a9',
    Domainname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: {
      '80/tcp': {},
    },
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      'PHP_INI_DIR=/usr/local/etc/php',
      'APACHE_CONFDIR=/etc/apache2',
      'APACHE_ENVVARS=/etc/apache2/envvars',
      'PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_LDFLAGS=-Wl,-O1 -pie',
      'GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      'PHP_VERSION=8.2.20',
      'PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz',
      'PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      'PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      'MAX_EXECUTION_TIME=600',
      'MEMORY_LIMIT=512M',
      'UPLOAD_LIMIT=2048K',
      'TZ=UTC',
      'SESSION_SAVE_PATH=/sessions',
      'VERSION=5.2.1',
      'SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      'URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
    ],
    Cmd: [
      '/bin/sh',
      '-c',
      '#(nop) ',
      'CMD ["apache2-foreground"]',
    ],
    Image: 'sha256:2c67feea200e7de40c61fc910b8db697eff54b870cc81a18b44b2969eab60db2',
    Volumes: null,
    WorkingDir: '/var/www/html',
    Entrypoint: [
      '/docker-entrypoint.sh',
    ],
    OnBuild: null,
    Labels: {
      'org.opencontainers.image.authors': 'The phpMyAdmin Team <developers@phpmyadmin.net>',
      'org.opencontainers.image.description': 'Run phpMyAdmin with Alpine, Apache and PHP FPM.',
      'org.opencontainers.image.documentation': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.licenses': 'GPL-2.0-only',
      'org.opencontainers.image.source': 'https://github.com/phpmyadmin/docker.git',
      'org.opencontainers.image.title': 'Official phpMyAdmin Docker image',
      'org.opencontainers.image.url': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.vendor': 'phpMyAdmin',
      'org.opencontainers.image.version': '5.2.1',
    },
    StopSignal: 'SIGWINCH',
  },
  created: '2024-06-13T10:33:26.127447166Z',
  docker_version: '23.0.11',
  history: [
    {
      created: '2024-06-13T00:39:50.489759524Z',
      created_by: '/bin/sh -c #(nop) ADD file:5f17f77072bcd27aa8c4d09ef5117423b789c42445b6e6c13af711dfb2abd544 in / ',
    },
    {
      created: '2024-06-13T00:39:51.001674137Z',
      created_by: '/bin/sh -c #(nop)  CMD ["bash"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:27.337506469Z',
      created_by: "/bin/sh -c set -eux; \t{ \t\techo 'Package: php*'; \t\techo 'Pin: release *'; \t\techo 'Pin-Priority: -1'; \t} > /etc/apt/preferences.d/no-debian-php",
    },
    {
      created: '2024-06-13T05:31:27.434120664Z',
      created_by: '/bin/sh -c #(nop)  ENV PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:42.599095369Z',
      created_by: '/bin/sh -c set -eux; \tapt-get update; \tapt-get install -y --no-install-recommends \t\t$PHPIZE_DEPS \t\tca-certificates \t\tcurl \t\txz-utils \t; \trm -rf /var/lib/apt/lists/*',
    },
    {
      created: '2024-06-13T05:31:44.297500492Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_INI_DIR=/usr/local/etc/php',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:44.757158498Z',
      created_by: '/bin/sh -c set -eux; \tmkdir -p "$PHP_INI_DIR/conf.d"; \t[ ! -d /var/www/html ]; \tmkdir -p /var/www/html; \tchown www-data:www-data /var/www/html; \tchmod 1777 /var/www/html',
    },
    {
      created: '2024-06-13T05:35:35.257056185Z',
      created_by: '/bin/sh -c #(nop)  ENV APACHE_CONFDIR=/etc/apache2',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:35.347240554Z',
      created_by: '/bin/sh -c #(nop)  ENV APACHE_ENVVARS=/etc/apache2/envvars',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:42.496173836Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.216631066Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.679700359Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.771486037Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:43.86198167Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:43.955633155Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_LDFLAGS=-Wl,-O1 -pie',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.474584842Z',
      created_by: '/bin/sh -c #(nop)  ENV GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.569977076Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_VERSION=8.2.20',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.667349271Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.767304905Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:59.381037511Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T06:03:59.535533927Z',
      created_by: '/bin/sh -c #(nop) COPY file:ce57c04b70896f77cc11eb2766417d8a1240fcffe5bba92179ec78c458844110 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:12.392267655Z',
      created_by: "/bin/sh -c set -eux; \t\tsavedAptMark=\"$(apt-mark showmanual)\"; \tapt-get update; \tapt-get install -y --no-install-recommends \t\tapache2-dev \t\tlibargon2-dev \t\tlibcurl4-openssl-dev \t\tlibonig-dev \t\tlibreadline-dev \t\tlibsodium-dev \t\tlibsqlite3-dev \t\tlibssl-dev \t\tlibxml2-dev \t\tzlib1g-dev \t; \t\texport \t\tCFLAGS=\"$PHP_CFLAGS\" \t\tCPPFLAGS=\"$PHP_CPPFLAGS\" \t\tLDFLAGS=\"$PHP_LDFLAGS\" \t\tPHP_BUILD_PROVIDER='https://github.com/docker-library/php' \t\tPHP_UNAME='Linux - Docker' \t; \tdocker-php-source extract; \tcd /usr/src/php; \tgnuArch=\"$(dpkg-architecture --query DEB_BUILD_GNU_TYPE)\"; \tdebMultiarch=\"$(dpkg-architecture --query DEB_BUILD_MULTIARCH)\"; \tif [ ! -d /usr/include/curl ]; then \t\tln -sT \"/usr/include/$debMultiarch/curl\" /usr/local/include/curl; \tfi; \t./configure \t\t--build=\"$gnuArch\" \t\t--with-config-file-path=\"$PHP_INI_DIR\" \t\t--with-config-file-scan-dir=\"$PHP_INI_DIR/conf.d\" \t\t\t\t--enable-option-checking=fatal \t\t\t\t--with-mhash \t\t\t\t--with-pic \t\t\t\t--enable-mbstring \t\t--enable-mysqlnd \t\t--with-password-argon2 \t\t--with-sodium=shared \t\t--with-pdo-sqlite=/usr \t\t--with-sqlite3=/usr \t\t\t\t--with-curl \t\t--with-iconv \t\t--with-openssl \t\t--with-readline \t\t--with-zlib \t\t\t\t--disable-phpdbg \t\t\t\t--with-pear \t\t\t\t$(test \"$gnuArch\" = 'riscv64-linux-gnu' && echo '--without-pcre-jit') \t\t--with-libdir=\"lib/$debMultiarch\" \t\t\t\t--disable-cgi \t\t\t\t--with-apxs2 \t; \tmake -j \"$(nproc)\"; \tfind -type f -name '*.a' -delete; \tmake install; \tfind \t\t/usr/local \t\t-type f \t\t-perm '/0111' \t\t-exec sh -euxc ' \t\t\tstrip --strip-all \"$@\" || : \t\t' -- '{}' + \t; \tmake clean; \t\tcp -v php.ini-* \"$PHP_INI_DIR/\"; \t\tcd /; \tdocker-php-source delete; \t\tapt-mark auto '.*' > /dev/null; \t[ -z \"$savedAptMark\" ] || apt-mark manual $savedAptMark; \tfind /usr/local -type f -executable -exec ldd '{}' ';' \t\t| awk '/=>/ { so = $(NF-1); if (index(so, \"/usr/local/\") == 1) { next }; gsub(\"^/(usr/)?\", \"\", so); printf \"*%s\\n\", so }' \t\t| sort -u \t\t| xargs -r dpkg-query --search \t\t| cut -d: -f1 \t\t| sort -u \t\t| xargs -r apt-mark manual \t; \tapt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \trm -rf /var/lib/apt/lists/*; \t\tpecl update-channels; \trm -rf /tmp/pear ~/.pearrc; \t\tphp --version",
    },
    {
      created: '2024-06-13T06:07:12.716287922Z',
      created_by: '/bin/sh -c #(nop) COPY multi:e11221d43af7136e4dbad5a74e659bcfa753214a9e615c3daf357f1633d9d3d1 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:13.203548326Z',
      created_by: '/bin/sh -c docker-php-ext-enable sodium',
    },
    {
      created: '2024-06-13T06:07:13.358228599Z',
      created_by: '/bin/sh -c #(nop)  ENTRYPOINT ["docker-php-entrypoint"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.452433348Z',
      created_by: '/bin/sh -c #(nop)  STOPSIGNAL SIGWINCH',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.552063667Z',
      created_by: '/bin/sh -c #(nop) COPY file:e3123fcb6566efa979f945bfac1c94c854a559d7b82723e42118882a8ac4de66 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:13.647192913Z',
      created_by: '/bin/sh -c #(nop) WORKDIR /var/www/html',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.737108588Z',
      created_by: '/bin/sh -c #(nop)  EXPOSE 80',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.833452068Z',
      created_by: '/bin/sh -c #(nop)  CMD ["apache2-foreground"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:14.82107478Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:14.975181338Z',
      created_by: '/bin/sh -c #(nop)  ENV MAX_EXECUTION_TIME=600',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.069389391Z',
      created_by: '/bin/sh -c #(nop)  ENV MEMORY_LIMIT=512M',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.164442845Z',
      created_by: '/bin/sh -c #(nop)  ENV UPLOAD_LIMIT=2048K',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.258040428Z',
      created_by: '/bin/sh -c #(nop)  ENV TZ=UTC',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.353873797Z',
      created_by: '/bin/sh -c #(nop)  ENV SESSION_SAVE_PATH=/sessions',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.826784525Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:15.920682434Z',
      created_by: '/bin/sh -c #(nop)  ENV VERSION=5.2.1',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.016311856Z',
      created_by: '/bin/sh -c #(nop)  ENV SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.111034053Z',
      created_by: '/bin/sh -c #(nop)  ENV URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.206581258Z',
      created_by: '/bin/sh -c #(nop)  LABEL org.opencontainers.image.title=Official phpMyAdmin Docker image org.opencontainers.image.description=Run phpMyAdmin with Alpine, Apache and PHP FPM. org.opencontainers.image.authors=The phpMyAdmin Team <developers@phpmyadmin.net> org.opencontainers.image.vendor=phpMyAdmin org.opencontainers.image.documentation=https://github.com/phpmyadmin/docker#readme org.opencontainers.image.licenses=GPL-2.0-only org.opencontainers.image.version=5.2.1 org.opencontainers.image.url=https://github.com/phpmyadmin/docker#readme org.opencontainers.image.source=https://github.com/phpmyadmin/docker.git',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:25.489636493Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:25.835738873Z',
      created_by: '/bin/sh -c #(nop) COPY file:f697d9b67ffcb023f485f153138036d27b209f81ffe35ce3b93a825c617138cd in /etc/phpmyadmin/config.inc.php ',
    },
    {
      created: '2024-06-13T10:33:25.94764847Z',
      created_by: '/bin/sh -c #(nop) COPY file:4c44b9819df4178e9ea9cadac940244ec91f94d66f4c1ab6f3707a059dcd485c in /docker-entrypoint.sh ',
    },
    {
      created: '2024-06-13T10:33:26.033735095Z',
      created_by: '/bin/sh -c #(nop)  ENTRYPOINT ["/docker-entrypoint.sh"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:26.127447166Z',
      created_by: '/bin/sh -c #(nop)  CMD ["apache2-foreground"]',
      empty_layer: true,
    },
  ],
  os: 'linux',
  rootfs: {
    type: 'layers',
    diff_ids: [
      'sha256:72c690143394392f22d311d60d7b2cada541166fddd89ddf69d9564f3160e0fd',
      'sha256:2ca469df2d7a64c1ce3fa8c98f94112c4b4a1760efdc68a35b2ac0b4d3280ff0',
      'sha256:ecbda56a4ecd649c1b14765acf5d6055c50927ddee37bea93150cb42bb872fb9',
      'sha256:5a578fe88ffcb0dd4e6605faddd7fe9979efd51ab370f0fc88365f67f97498c1',
      'sha256:3f33b2d8d4bcad157068182e90b8b5adcc157c51233849d7405c1e1747cc513a',
      'sha256:8cb0c7be5c25df0616ee3a2f0ee9418a3b2686bc1ea3273ab9e19deb36fff8c9',
      'sha256:21fd75a3f453bf57a64d5ed1694e9e85d15feeaa63afeebfa8301d5ba1208b8f',
      'sha256:e96b94137eb634833e7f7718fe3b64999e1de8305549bd1d229972e67ff59711',
      'sha256:c3589190f5be5ec7bc53d57179208569bcd91ce28c287eaa8b9d088618c97c4e',
      'sha256:e59e93e1c54efd8b6fb9f712a89e020bc99c101615b6e1f1095deb705acfbd9c',
      'sha256:3dd11762b08d03a100eeef942310cd68c48476ae704bd5bc2e93e8271d2eeb53',
      'sha256:60b6a6afca7aa5ea9dd3953ea8724c334d27c2c4ab0cf00e37e7670de490eb73',
      'sha256:df2e661dca7992d2fa1f645e87e3eab90ff2b770b7dda5774f6f8aa41846f422',
      'sha256:5c7c06a5493314b5582de393693f5381ba81d62386e29ef8a1a5af27b563a858',
      'sha256:4f0f66e38a64759ea918d3d6a2dc43ad65870a878e82392f460bc7d06729cb2a',
      'sha256:35611a4633bf186d1be9ce71c05b9ef27688f223042fbd33fc18b43cd2551f5c',
      'sha256:1b66a7e8d178fd52ff61d6f9f6f4aa42895b6f2d2466c05f937076660cfba6f8',
      'sha256:6621e6566368be8d65172801a6880fca8aad7010565bfc36be313b181728c736',
    ],
  },
  variant: 'v8',
};

// megachips/ipshow (Config)
const imageConfigAmd64 = {
  architecture: 'amd64',
  config: {
    Env: [
      'PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'LANG=C.UTF-8',
      'GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D',
      'PYTHON_VERSION=3.11.7',
      'PYTHON_PIP_VERSION=23.2.1',
      'PYTHON_SETUPTOOLS_VERSION=65.5.1',
      'PYTHON_GET_PIP_URL=https://github.com/pypa/get-pip/raw/049c52c665e8c5fd1751f942316e0a5c777d304f/public/get-pip.py',
      'PYTHON_GET_PIP_SHA256=7cfd4bdc4d475ea971f1c0710a5953bcc704d171f83c797b9529d9974502fcc6',
    ],
    Entrypoint: [
      'python3',
      'app.py',
    ],
    WorkingDir: '/app',
    ArgsEscaped: true,
    OnBuild: null,
  },
  created: '2024-01-28T08:34:02.310843905Z',
  history: [
    {
      created: '2024-01-27T00:30:48.624602109Z',
      created_by: '/bin/sh -c #(nop) ADD file:37a76ec18f9887751cd8473744917d08b7431fc4085097bb6a09d81b41775473 in / ',
    },
    {
      created: '2024-01-27T00:30:48.743965523Z',
      created_by: '/bin/sh -c #(nop)  CMD ["/bin/sh"]',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV LANG=C.UTF-8',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'RUN /bin/sh -c set -eux; \tapk add --no-cache \t\tca-certificates \t\ttzdata \t; # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_VERSION=3.11.7',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'RUN /bin/sh -c set -eux; \tfor src in idle3 pydoc3 python3 python3-config; do \t\tdst="$(echo "$src" | tr -d 3)"; \t\t[ -s "/usr/local/bin/$src" ]; \t\t[ ! -e "/usr/local/bin/$dst" ]; \t\tln -svT "$src" "/usr/local/bin/$dst"; \tdone # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_PIP_VERSION=23.2.1',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_SETUPTOOLS_VERSION=65.5.1',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_GET_PIP_URL=https://github.com/pypa/get-pip/raw/049c52c665e8c5fd1751f942316e0a5c777d304f/public/get-pip.py',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_GET_PIP_SHA256=7cfd4bdc4d475ea971f1c0710a5953bcc704d171f83c797b9529d9974502fcc6',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'CMD ["python3"]',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2024-01-27T21:26:58.705651175Z',
      created_by: 'WORKDIR /app',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-27T21:27:07.384920178Z',
      created_by: 'RUN /bin/sh -c pip install aiohttp accept-types # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-28T08:34:02.310843905Z',
      created_by: 'COPY app.py . # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-28T08:34:02.310843905Z',
      created_by: 'ENTRYPOINT ["python3" "app.py"]',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
  ],
  os: 'linux',
  rootfs: {
    type: 'layers',
    diff_ids: [
      'sha256:d4fc045c9e3a848011de66f34b81f052d4f2c15a17bb196d637e526349601820',
      'sha256:678cac8b069e3d95557415ac228c218d0fff534f1282c9c791b9736f89a7cea2',
      'sha256:8fde1a6f4000d3280c06ce5fda8b977fae1ab3938447a58d59d215faf03bd58f',
      'sha256:4985f9438c299fb15bbb8756467c2638f93b7b908fdb73f0d76e9b948645a80f',
      'sha256:6cedb0fbc9d9ea9667a2d8c1c7bab0b3c4ecf75534917c596f6bd12509957c52',
      'sha256:233b76fd3ce8befb773525f7f07a8b994f977e5232a35be38a50bc26d936eb2d',
      'sha256:e322997e528a8abb04a5f1291da49994942dba0f25de9f3d52a6c810298e1612',
      'sha256:1644f563c622ede6aefd120357c692246ed0145fb83e729df26a8498012333ae',
    ],
  },
};

// made up
const oversizeDistributionManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22062,
    digest:
      'sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29150411,
      digest:
        'sha256:09f376ebb190216b0459f470e71bec7b5dfa611d66bf008492b40dcc5f1d8eae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 225,
      digest:
        'sha256:76afcdc8655129b4b8245d674820f06020b8a54f3db6c8d9147234b985f3c923',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 104357718,
      digest:
        'sha256:ceed4541c527d7a443908138f347495ec250ba7a1e70d8dd6b567464064ee115',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 270,
      digest:
        'sha256:9ec84be954b08b2782f93426799a585ad7b33b0e7d57b3f725218d450ea5d20d',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20329735,
      digest:
        'sha256:ff0e278869f981b14b52a6f43e6a0ce131ed2f3067de4314ed34393669549724',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 474,
      digest:
        'sha256:1693466e4cc6edc54994f2c9c9e1989f28b0df6243b3c709876e36a999aac7ee',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 510,
      digest:
        'sha256:57c8d94a4882fa141e8c25a4a5ea1f1188629cc772674bdc7dcd69c13a07bd25',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428793,
      digest:
        'sha256:43af3fe8136ad9261342f5add4a18489a3ffc70ba50f2651ea7cc1b3d0e45875',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:ddef75e08a5d03695ba1b0ce20598e067646188c87a8367b98c0b1768a280b7f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      // yuge
      size: 1140760600000,
      digest:
        'sha256:a4ba0bdbbf0a7e73b6acc7dcd82c8dbc4635884963f73bbebcbac1a2f988cf99',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:29e89bc69515a29ca19a9f9d5159e84862484ce94772369f8eb8ea55471b22ae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 246,
      digest:
        'sha256:bdad2781572257d109331576ace9e6292ca5bab9a8d069e9f59bf185db3c1b29',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 893,
      digest:
        'sha256:dbbbc9a8833202619954978f80ebc0a2284f0e0b248972d29a930f7461853b61',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3212419,
      digest:
        'sha256:dbb7df25a76e3f547e39f1d1c6446fec585440ab4bda3ce2d3cf9a860ab7c990',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 582,
      digest:
        'sha256:2cedf1ee513bf5eda7415e9d81a011565ce786aca7d29688d54b7569b64e0179',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016080,
      digest:
        'sha256:b29f15d25d619f8fdbf3f5241916c85e91a1e7f13c4ca7809f81c0c8cf43049c',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:0c455ba0c479f0e90ff42487c0bbc46a9a6fb9479e687ad62b883c85b1c2dd38',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 928,
      digest:
        'sha256:87f4d138451a04e398076c63aae11f592e796f19b6c4be27457ef128df3736da',
    },
  ],
};

// made up
const oversizeOciManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:07bc88e18c4aea4343fc16a9930da57308d4df45d3d234aebcd5b1c1833ee290',
      size: 48994878,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1a9c1668bf493c4df11d8a9377aeb8ef94c277c39d700470d6757f4affe812fa',
      size: 881,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1021dda8eecff015672845c8c131d475eccb83c09569a18640c2cda4399decf2',
      size: 983004,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:fb61b56acac1145d05c716918b447019808fac364743d1232e647845748f5020',
      // yuge
      size: 67115291234,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0bca83908a5b1425517e978c51f3b8631610670037c49db9c3663a7915e20c53',
      size: 2602,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:165e8b3d37ca389e737cbc06dbd776556f3fb96311ed68ea52825fbc64685450',
      size: 333,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:3e1b086f129564f4f57b1cf79b288cf54a9e5c3a1c43219db46a1b493d40cded',
      size: 47215103,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:dba6516684849c81829a8787e5e56a203bad4854df16430fa2e3ca837d94e1d4',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:ed90f5355e12edb07b8cdaa438ef1d088e2e3121ed5b04904aaf98e79555c572',
      size: 64786544,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0412f59ab2b5360b2f2648828b0e7dd7483aa35d13a6623fcc7752d23414e9ea',
      size: 5185,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'amd64',
    'org.opencontainers.image.base.digest':
      'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// made up
const distributionManifestListUnsupported = {
  manifests: [
    {
      digest:
        'sha256:94a416e0f2a6ffc28e68f86616739cd211eab91ad092e23ac92a6c2759a2a5e4',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: '386', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:2fec163305d0361a996ee6877b410e55ceec18e715e7c536e55289450880f7f3',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 4080,
    },
    {
      digest:
        'sha256:7ae932f82ae089a9558f27b1e08024931ea81b2a70599498db904dee53a91044',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'ppc64le', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:d30203e99d1457ce1e56c3f0c829b05e09771a88b1ea9b09d1b609fa6b6e43b6',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 's390x', os: 'linux' },
      size: 4080,
    },
  ],
  mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
  schemaVersion: 2,
};

const ociIndexUnsupported = {
  manifests: [
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'mips64le',
        'org.opencontainers.image.base.digest':
          'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-02T00:58:55Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 2857,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'mips64le',
        'vnd.docker.reference.digest':
          'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:01efa5c8f1824bd63acbd8736a48cb22f117881b7574b0052a385b7251dc1061',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
  ],
  mediaType: 'application/vnd.oci.image.index.v1+json',
  schemaVersion: 2,
};

module.exports = {
  ociIndex,
  ociIndexUnsupported,
  ociManifestAmd64,
  ociManifestArm64,
  distributionManifestList,
  distributionManifestListUnsupported,
  distributionManifestAmd64,
  distributionManifestArm64,
  imageConfigAmd64,
  imageConfigArm64,
  oversizeDistributionManifestAmd64,
  oversizeOciManifestAmd64,
};
