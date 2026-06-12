package framework

const fallbackVersion = "dev"

var buildVersion = fallbackVersion

func Version() string {
	if buildVersion == "" {
		return fallbackVersion
	}
	return buildVersion
}

func VersionMenuText() string {
	return "版本：" + Version()
}
